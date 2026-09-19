import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { randomUUID } from "crypto";
import {
  ENCRYPTED_FIELDS,
  EnvelopeError,
  encryptWithKey,
  decryptWithKey,
  blindIndex,
} from "@/lib/encryption";
import { generateDek, unwrapDek, isKmsConfigured } from "@/lib/kms";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const basePrisma = new PrismaClient({ adapter });

function getModelName(model: string | undefined): string | undefined {
  if (!model) return undefined;
  return model.charAt(0).toUpperCase() + model.slice(1);
}

type EncryptionContext = { recordType: string; recordId: string };

// Prisma's pg adapter returns Bytes columns as Uint8Array (not Buffer). `instanceof Buffer`
// returns false for plain Uint8Arrays; we check the wider type and coerce when handing to crypto.
function isBytes(x: unknown): x is Uint8Array {
  return x instanceof Uint8Array;
}
function toBuffer(x: Uint8Array): Buffer {
  return Buffer.isBuffer(x) ? x : Buffer.from(x.buffer, x.byteOffset, x.byteLength);
}

// Relation map per model — used to recursively decrypt nested rows that come back via `include`.
// Built manually from prisma/schema.prisma. Keep in sync if you add a relation.
const RELATIONS: Record<string, Record<string, string>> = {
  User: {
    articles: "Article",
    articleCredits: "ArticleCredit",
    approvals: "Approval",
    roundTableSides: "RoundTableSideAuthor",
  },
  Article: {
    createdBy: "User",
    credits: "ArticleCredit",
    images: "ArticleImage",
    group: "ArticleGroup",
    blockSlots: "BlockSlot",
    approvals: "Approval",
  },
  ArticleCredit: { article: "Article", user: "User" },
  ArticleImage: { article: "Article" },
  ArticleGroup: {
    blocks: "LayoutBlock",
    articles: "Article",
    approvals: "Approval",
    roundTables: "RoundTable",
  },
  RoundTable: {
    group: "ArticleGroup",
    sides: "RoundTableSide",
    turns: "RoundTableTurn",
  },
  RoundTableSide: {
    roundTable: "RoundTable",
    authors: "RoundTableSideAuthor",
    turns: "RoundTableTurn",
  },
  RoundTableTurn: { roundTable: "RoundTable", side: "RoundTableSide" },
  RoundTableSideAuthor: { side: "RoundTableSide", user: "User" },
  Approval: { user: "User", article: "Article", group: "ArticleGroup" },
  LayoutBlock: { group: "ArticleGroup", slots: "BlockSlot" },
  BlockSlot: { block: "LayoutBlock", article: "Article" },
  // NextAuth adapter touchpoints — `account.findUnique({ select: { user: true } })` is the
  // sign-in lookup; without recursion here the User comes back undecrypted and signIn fails.
  Account: { user: "User" },
  Session: { user: "User" },
};

// A select that asks for an encrypted field but omits the envelope columns it is stored in can
// only ever return NULL for that field — and NULL then flows into pages that expect a string.
// Outside production that is a bug in the caller's `select`, so fail loudly and name the field
// (use the shapes in lib/prisma-selects.ts). In production we keep serving the page: a blank
// byline beats a 500 on the homepage.
function reportIncompleteSelect(
  modelName: string,
  encryptedFields: string[],
  missingColumn: string,
): void {
  const message =
    `${modelName}.${encryptedFields.join(`, ${modelName}.`)} cannot be decrypted: the select ` +
    `omits \`${missingColumn}\`. Add id, encryptedDek and <field>Ciphertext to the select ` +
    `(see lib/prisma-selects.ts).`;
  if (process.env.NODE_ENV === "production") {
    console.error(`[prisma envelope-read] ${message}`);
    return;
  }
  throw new EnvelopeError(message);
}

// Read path: when a returned row carries a populated `encryptedDek`, decrypt the *Ciphertext
// columns and populate the (NULL on disk) plaintext fields with the decrypted values.
// Recursively walks `include`d relations so nested encrypted models (e.g. Article.createdBy)
// also get decrypted, not just the top-level model.
async function applyEnvelopeRead(
  modelName: string,
  result: unknown,
): Promise<void> {
  if (!isKmsConfigured() || result == null) return;
  if (Array.isArray(result)) {
    // Parallelize sibling rows so KMS calls fan out instead of running serially. With ~30
    // encrypted rows per homepage render, this turns a 900ms wait into ~50ms.
    await Promise.all(result.map((item) => applyEnvelopeRead(modelName, item)));
    return;
  }
  if (typeof result !== "object") return;
  const r = result as Record<string, unknown>;

  // Kick off this row's DEK unwrap and recurse into relations in parallel.
  const fields = ENCRYPTED_FIELDS[modelName];
  let selfPromise: Promise<void> = Promise.resolve();
  if (fields) {
    const wrapped = r.encryptedDek;
    const id = r.id;
    const hasDek = isBytes(wrapped) && wrapped.length > 0;
    // Which encrypted fields did this query actually ask for? A key that is absent from the row
    // was not selected; a key that is present must be decryptable.
    const requested = Object.keys(fields).filter((f) => f in r);

    if (requested.length > 0 && (!hasDek || typeof id !== "string")) {
      reportIncompleteSelect(
        modelName,
        requested,
        typeof id !== "string" ? "id" : "encryptedDek",
      );
    } else if (hasDek && typeof id === "string") {
      const missingCiphertext = requested.filter((f) => !(`${f}Ciphertext` in r));
      if (missingCiphertext.length > 0) {
        reportIncompleteSelect(modelName, missingCiphertext, `${missingCiphertext[0]}Ciphertext`);
      }
      const ctx: EncryptionContext = { recordType: modelName, recordId: id };
      selfPromise = unwrapDek(toBuffer(wrapped as Uint8Array), ctx)
        .then((dek) => {
          for (const field of Object.keys(fields)) {
            const ct = r[`${field}Ciphertext`];
            if (!isBytes(ct) || ct.length === 0) continue;
            try {
              r[field] = decryptWithKey(toBuffer(ct), dek);
            } catch (err) {
              console.error(
                `[prisma envelope-read] ${modelName}.${field}/${id} decrypt failed: ${(err as Error).message}`,
              );
            }
          }
        })
        .catch((err) => {
          console.error(
            `[prisma envelope-read] ${modelName}/${id} unwrap failed: ${(err as Error).message}`,
          );
        });
    }
  }

  const relations = RELATIONS[modelName];
  const relPromises: Promise<void>[] = [];
  if (relations) {
    for (const [relName, relModel] of Object.entries(relations)) {
      if (!(relName in r)) continue;
      relPromises.push(applyEnvelopeRead(relModel, r[relName]));
    }
  }

  await Promise.all([selfPromise, ...relPromises]);
}

// Rewrite where clauses on deterministic-encrypted fields to hit the blind-index hash column
// instead of the (always-NULL) plaintext column. Hash-only, which keeps `findUnique` semantics
// intact (Prisma rejects `OR` in UniqueWhereInput).
function applyEnvelopeWhere(
  modelName: string,
  where: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!where || !isKmsConfigured()) return where;
  const fields = ENCRYPTED_FIELDS[modelName];
  if (!fields) return where;

  const result = { ...where };
  for (const [key, value] of Object.entries(result)) {
    if (fields[key] !== "deterministic") continue;

    if (typeof value === "string") {
      delete result[key];
      result[`${key}Hash`] = blindIndex(value);
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      // operator object: { email: { equals: "x" } } / { in: [...] } / { not: "y" }
      const ops = value as Record<string, unknown>;
      const hashOps: Record<string, unknown> = {};
      if (typeof ops.equals === "string") hashOps.equals = blindIndex(ops.equals);
      if (Array.isArray(ops.in)) {
        hashOps.in = ops.in.map((v: unknown) =>
          typeof v === "string" ? blindIndex(v) : v,
        );
      }
      if (typeof ops.not === "string") hashOps.not = blindIndex(ops.not);
      if (Object.keys(hashOps).length > 0) {
        delete result[key];
        result[`${key}Hash`] = hashOps;
      }
    }
  }
  // Recurse into AND/OR/NOT clauses so nested deterministic predicates are rewritten too.
  if (Array.isArray(result.AND)) {
    result.AND = (result.AND as Record<string, unknown>[]).map((c) =>
      applyEnvelopeWhere(modelName, c) ?? c,
    );
  }
  if (Array.isArray(result.OR)) {
    result.OR = (result.OR as Record<string, unknown>[]).map((c) =>
      applyEnvelopeWhere(modelName, c) ?? c,
    );
  }
  if (result.NOT && typeof result.NOT === "object") {
    if (Array.isArray(result.NOT)) {
      result.NOT = (result.NOT as Record<string, unknown>[]).map((c) =>
        applyEnvelopeWhere(modelName, c) ?? c,
      );
    } else {
      result.NOT = applyEnvelopeWhere(
        modelName,
        result.NOT as Record<string, unknown>,
      );
    }
  }
  return result;
}

// Write path: populate the *Ciphertext / *Hash / encryptedDek / dekKekVersion columns and delete
// the plaintext key from the payload so Prisma stores NULL in the (legacy) plaintext column.
//
// Guarantees:
//   - On create: a fresh DEK is generated; ciphertext columns are populated for every plaintext
//     present in args.data; the encryption context is { recordType, recordId } where recordId is
//     the UUID we explicitly assign so it matches what the row will end up with.
//   - On update: the row's existing DEK is unwrapped and reused, so the *Ciphertext columns this
//     update does NOT touch stay decryptable. A row is never re-keyed.
//   - Failure path: when KMS is configured, EVERY failure throws. There is no legacy fallback and
//     no silent skip: a failed envelope write must fail the whole query, because the alternative
//     is a write that looks like it succeeded and reads back NULL (or, worse, plaintext) later.
async function applyEnvelopeWrite(
  modelName: string,
  operation: string,
  args: Record<string, unknown>,
): Promise<void> {
  if (!isKmsConfigured()) return;
  const fields = ENCRYPTED_FIELDS[modelName];
  if (!fields) {
    // Even when the top-level model isn't encrypted, nested writes might be (e.g.,
    // ArticleGroup.create({ articles: { create: [...] } }) where Article IS encrypted).
    await applyEnvelopeWriteNested(modelName, args);
    return;
  }

  if (
    operation !== "create" &&
    operation !== "createMany" &&
    operation !== "update" &&
    operation !== "updateMany" &&
    operation !== "upsert"
  ) {
    await applyEnvelopeWriteNested(modelName, args);
    return;
  }

  // An encrypted row can only be updated through its id: the encryption context is bound to it,
  // and `updateMany` would need one DEK per matched row. Anything else used to fall through to a
  // path that wrote the new value nowhere the read path looks — a silently lost update.
  if (operation === "update" || operation === "updateMany") {
    const where = args.where as Record<string, unknown> | undefined;
    if (!where || typeof where.id !== "string") {
      throw new EnvelopeError(
        `${modelName}: encrypted models must be updated by id (got where keys: ${
          where && Object.keys(where).length > 0 ? Object.keys(where).join(", ") : "none"
        })`,
      );
    }
  }

  // Locate the data block we need to mutate. For upsert there are separate create/update keys.
  const dataBlocks: Record<string, unknown>[] = [];
  if (operation === "upsert") {
    if (args.create && typeof args.create === "object") dataBlocks.push(args.create as Record<string, unknown>);
    if (args.update && typeof args.update === "object") dataBlocks.push(args.update as Record<string, unknown>);
  } else if (args.data && typeof args.data === "object") {
    if (Array.isArray(args.data)) {
      for (const item of args.data) {
        if (item && typeof item === "object") dataBlocks.push(item as Record<string, unknown>);
      }
    } else {
      dataBlocks.push(args.data as Record<string, unknown>);
    }
  }
  if (dataBlocks.length === 0) {
    await applyEnvelopeWriteNested(modelName, args);
    return;
  }

  for (const data of dataBlocks) {
    const hasPlaintext = Object.keys(fields).some((f) => typeof data[f] === "string");
    const isCreateBlock =
      operation === "create" ||
      operation === "createMany" ||
      (operation === "upsert" && data === (args.create as unknown));

    // Nothing to encrypt in this block (e.g. `update: {}` in an upsert, or an update that only
    // touches non-encrypted columns): no DEK needed, leave the row's envelope columns alone.
    if (!hasPlaintext && !isCreateBlock) continue;

    // Resolve the row id we'll bind the encryption context to.
    let recordId: string | undefined;
    if (typeof data.id === "string") {
      recordId = data.id;
    } else if (isCreateBlock) {
      // Generate up-front so the encryption context matches what Prisma stores.
      recordId = randomUUID();
      data.id = recordId;
    } else {
      const where = args.where as Record<string, unknown> | undefined;
      if (where && typeof where.id === "string") recordId = where.id;
    }
    if (!recordId) {
      throw new EnvelopeError(
        `${modelName}.${operation}: cannot bind an encryption context without a record id ` +
          `(encrypted models must be written by id)`,
      );
    }

    const ctx = { recordType: modelName, recordId };

    // Reuse the row's existing DEK on update so previously-written ciphertext on the same row
    // stays decryptable; mint a fresh one only for a row that does not have one yet.
    let dek: Buffer;

    const existing = isCreateBlock ? null : await findExistingRow(modelName, args.where);
    const existingWrapped =
      existing && isBytes(existing.encryptedDek) && (existing.encryptedDek as Uint8Array).length > 0
        ? toBuffer(existing.encryptedDek as Uint8Array)
        : null;

    if (existingWrapped) {
      try {
        dek = await unwrapDek(existingWrapped, ctx);
      } catch (err) {
        // Never mint a fresh DEK for a row that already has one: that would orphan every
        // *Ciphertext column this write does not touch.
        throw new EnvelopeError(
          `${modelName}/${recordId}: cannot re-key existing row — unwrapping its DEK failed ` +
            `(${(err as Error).message})`,
        );
      }
    } else {
      const fresh = await generateDek(ctx);
      dek = fresh.dek;
      data.encryptedDek = fresh.wrappedDek;
      data.dekKekVersion = fresh.kekVersion;
    }

    try {
      // Encrypt every plaintext field present in this data block, then DELETE the plaintext field
      // name so Prisma writes NULL to the legacy column. The read path synthesizes the plaintext
      // back from the envelope columns.
      for (const [field, mode] of Object.entries(fields)) {
        const plaintext = data[field];
        if (typeof plaintext !== "string") continue;
        data[`${field}Ciphertext`] = encryptWithKey(plaintext, dek);
        if (mode === "deterministic") {
          data[`${field}Hash`] = blindIndex(plaintext);
        }
        delete data[field];
      }
    } finally {
      // Wipe the plaintext DEK from memory before this iteration ends. unwrapDek() hands out a
      // copy, so this does not poison the cache.
      dek.fill(0);
    }
  }

  // Recurse into nested creates so e.g. Article.create({ data: { credits: { create: [...] } } })
  // populates each nested ArticleCredit's envelope columns too.
  await applyEnvelopeWriteNested(modelName, args);
}

// Read the row being updated straight from the unextended client (no recursion through this
// extension) to get its wrapped DEK.
async function findExistingRow(
  modelName: string,
  where: unknown,
): Promise<Record<string, unknown> | null> {
  if (!where || typeof where !== "object") return null;
  const delegateName = modelName.charAt(0).toLowerCase() + modelName.slice(1);
  const modelDelegate = (
    basePrisma as unknown as Record<string, { findUnique: (a: unknown) => Promise<unknown> }>
  )[delegateName];
  if (!modelDelegate) return null;
  return (await modelDelegate.findUnique({ where })) as Record<string, unknown> | null;
}

// Walk known relations on data blocks and apply envelope-write recursively to nested writes.
// Handles `{ create: X | X[] }` and `{ createMany: { data: X[] } }` shapes.
async function applyEnvelopeWriteNested(
  modelName: string,
  args: Record<string, unknown>,
): Promise<void> {
  if (!isKmsConfigured()) return;
  const relations = RELATIONS[modelName];
  if (!relations) return;

  const dataBlocks: Record<string, unknown>[] = [];
  if (args.create && typeof args.create === "object" && !Array.isArray(args.create)) {
    dataBlocks.push(args.create as Record<string, unknown>);
  }
  if (args.update && typeof args.update === "object" && !Array.isArray(args.update)) {
    dataBlocks.push(args.update as Record<string, unknown>);
  }
  if (args.data) {
    if (Array.isArray(args.data)) {
      for (const item of args.data) {
        if (item && typeof item === "object") dataBlocks.push(item as Record<string, unknown>);
      }
    } else if (typeof args.data === "object") {
      dataBlocks.push(args.data as Record<string, unknown>);
    }
  }

  for (const data of dataBlocks) {
    for (const [relName, relModel] of Object.entries(relations)) {
      const relValue = data[relName];
      if (!relValue || typeof relValue !== "object" || Array.isArray(relValue)) continue;
      const relObj = relValue as Record<string, unknown>;

      if ("create" in relObj && relObj.create) {
        const items = Array.isArray(relObj.create) ? relObj.create : [relObj.create];
        for (const item of items) {
          if (item && typeof item === "object") {
            await applyEnvelopeWrite(relModel, "create", { data: item });
          }
        }
      }
      if ("createMany" in relObj && relObj.createMany) {
        const inner = relObj.createMany as Record<string, unknown>;
        const items = Array.isArray(inner.data) ? inner.data : [];
        for (const item of items) {
          if (item && typeof item === "object") {
            await applyEnvelopeWrite(relModel, "create", { data: item });
          }
        }
      }
    }
  }
}

const encryptedPrisma = basePrisma.$extends({
  query: {
    async $allOperations({ model, operation, args, query }) {
      if (!model) return query(args);

      const modelName = getModelName(model);
      if (!modelName) return query(args);

      // Non-encrypted models can still have encrypted nested includes (e.g. ArticleGroup with
      // blocks→slots→article). Apply envelope writes for nested data, run the query, recursively
      // decrypt nested rows.
      if (!ENCRYPTED_FIELDS[modelName]) {
        await applyEnvelopeWriteNested(modelName, args as Record<string, unknown>);
        const result = await query(args);
        await applyEnvelopeRead(modelName, result);
        return result;
      }

      const mutableArgs = { ...args } as Record<string, unknown>;

      // Rewrite where clauses on deterministic fields to hit the blind-index hash column.
      if (mutableArgs.where && typeof mutableArgs.where === "object") {
        mutableArgs.where = applyEnvelopeWhere(
          modelName,
          mutableArgs.where as Record<string, unknown>,
        );
      }

      // Encrypt everything on the way in. Throws (EnvelopeError) rather than degrading if KMS is
      // configured and anything goes wrong — there is no legacy path left to fall back to.
      await applyEnvelopeWrite(modelName, operation, mutableArgs);

      const result = await query(mutableArgs);
      await applyEnvelopeRead(modelName, result);
      return result;
    },
  },
});

const globalForPrisma = globalThis as unknown as { prisma: typeof encryptedPrisma };

export const prisma = globalForPrisma.prisma || encryptedPrisma;

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
