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
    if (isBytes(wrapped) && wrapped.length > 0) {
      const id = r.id;
      if (typeof id === "string") {
        const ctx: EncryptionContext = { recordType: modelName, recordId: id };
        selfPromise = unwrapDek(toBuffer(wrapped), ctx)
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

// Phase 2 dual-write: populate the *Ciphertext / *Hash / encryptedDek / dekKekVersion
// columns added in the kms_envelope_phase1 migration. Legacy columns are still written by
// the encryptFields() path below. Reads still come from legacy columns until Phase 4.
//
// Guarantees:
//   - On create: a fresh DEK is generated; ciphertext columns populated for every plaintext
//     present in args.data; encryption context is { recordType, recordId } where recordId is
//     the UUID we explicitly assign so it matches what the row will end up with.
//   - On update/upsert: if the row already has an encryptedDek, we unwrap it and reuse it for
//     consistency with previously-written ciphertext on the same row. If not (row pre-dates
//     this code), we generate a fresh DEK.
//   - Failure path: if KMS is configured but a call fails, we log and skip envelope writes.
//     Legacy writes still succeed; the Phase 3 backfill resolves any inconsistency.
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
    try {
      // Resolve the row id we'll bind the encryption context to.
      let recordId: string | undefined;
      if (typeof data.id === "string") {
        recordId = data.id;
      } else if (
        operation === "create" ||
        operation === "createMany" ||
        (operation === "upsert" && data === (args.create as unknown))
      ) {
        // Generate up-front so the encryption context matches what Prisma stores.
        recordId = randomUUID();
        data.id = recordId;
      } else {
        // Update path: pull id off the where clause (only direct id targeting supported).
        const where = args.where as Record<string, unknown> | undefined;
        if (where && typeof where.id === "string") recordId = where.id;
      }
      if (!recordId) {
        // Without a stable record id we can't bind encryption context safely. Skip envelope for
        // this write — legacy will still cover it, backfill will sweep it later.
        continue;
      }

      const ctx = { recordType: modelName, recordId };

      // Decide whether to reuse an existing DEK or mint a new one. Update path may have an
      // existing wrapped DEK in the row; reuse it so previously-written ciphertext on the same
      // row stays decryptable.
      let dek: Buffer;
      let wrappedDek: Buffer | null = null;
      let kekVersion: number | null = null;

      if (operation === "update" && args.where) {
        try {
          const existing = (await (basePrisma as unknown as Record<string, { findUnique: (a: unknown) => Promise<unknown> }>)[
            modelName.charAt(0).toLowerCase() + modelName.slice(1)
          ].findUnique({
            where: args.where,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any)) as Record<string, unknown> | null;
          if (
            existing &&
            isBytes(existing.encryptedDek) &&
            (existing.encryptedDek as Uint8Array).length > 0
          ) {
            const wrappedExisting = toBuffer(existing.encryptedDek as Uint8Array);
            dek = await unwrapDek(wrappedExisting, ctx);
            wrappedDek = wrappedExisting;
            kekVersion = (existing.dekKekVersion as number | null) ?? 1;
          } else {
            const fresh = await generateDek(ctx);
            dek = fresh.dek;
            wrappedDek = fresh.wrappedDek;
            kekVersion = fresh.kekVersion;
          }
        } catch {
          const fresh = await generateDek(ctx);
          dek = fresh.dek;
          wrappedDek = fresh.wrappedDek;
          kekVersion = fresh.kekVersion;
        }
      } else {
        const fresh = await generateDek(ctx);
        dek = fresh.dek;
        wrappedDek = fresh.wrappedDek;
        kekVersion = fresh.kekVersion;
      }

      // Encrypt every plaintext field present in this data block, then DELETE the plaintext
      // field name so Prisma writes NULL to the legacy column. Phase 5 wipe-legacy keeps legacy
      // columns NULL on disk; the read path synthesizes plaintext from envelope columns.
      for (const [field, mode] of Object.entries(fields)) {
        const plaintext = data[field];
        if (typeof plaintext !== "string") continue;
        data[`${field}Ciphertext`] = encryptWithKey(plaintext, dek);
        if (mode === "deterministic") {
          data[`${field}Hash`] = blindIndex(plaintext);
        }
        delete data[field];
      }

      if (wrappedDek && kekVersion !== null) {
        // For update we only set encryptedDek if it wasn't already populated; on create we always set it.
        const isFreshDek = !(data.encryptedDek);
        if (isFreshDek) {
          data.encryptedDek = wrappedDek;
          data.dekKekVersion = kekVersion;
        }
      }

      // Wipe the plaintext DEK from memory before this iteration ends.
      dek.fill(0);
    } catch (err) {
      console.error(
        `[prisma envelope-write] ${modelName}.${operation} skipped envelope path: ${(err as Error).message}`,
      );
    }
  }

  // Recurse into nested creates so e.g. Article.create({ data: { credits: { create: [...] } } })
  // populates each nested ArticleCredit's envelope columns too.
  await applyEnvelopeWriteNested(modelName, args);
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
