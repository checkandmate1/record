// End-to-end regression suite for the envelope-encryption pipeline in lib/prisma.ts.
//
// The real $extends hook runs; only its two edges are faked:
//   - @prisma/client        -> __tests__/helpers/fake-prisma.ts (in-memory rows)
//   - @aws-sdk/client-kms   -> __mocks__/@aws-sdk/client-kms.ts (in-memory wrap/unwrap)
// No database, no AWS. This is the suite docs/security-todo.md item 4 asked for.

jest.mock("@prisma/adapter-pg", () => ({
  PrismaPg: class {
    constructor(_config: unknown) {}
  },
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock("@prisma/client", () => require("../helpers/fake-prisma"));

import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { EnvelopeError, initEncryption } from "@/lib/encryption";
import { _resetDekCache } from "@/lib/kms";
import { __store, __resetStore } from "../helpers/fake-prisma";

const { __kms } = jest.requireMock("@aws-sdk/client-kms") as {
  __kms: { generateCalls: number; decryptCalls: number; failGenerate: boolean; failDecrypt: boolean; reset(): void };
};

type Row = Record<string, unknown>;
// The fake client is untyped on purpose — Prisma's generated types don't describe it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
function setNodeEnv(value: string) {
  Object.defineProperty(process.env, "NODE_ENV", { value, writable: true, configurable: true });
}

function storedUser(id: string): Row {
  const row = __store.user.find((r) => r.id === id);
  if (!row) throw new Error(`no stored user ${id}`);
  return row;
}
function storedArticle(id: string): Row {
  const row = __store.article.find((r) => r.id === id);
  if (!row) throw new Error(`no stored article ${id}`);
  return row;
}

beforeAll(() => {
  initEncryption(randomBytes(32).toString("hex"));
});

beforeEach(() => {
  process.env.KMS_KEY_ARN = "arn:aws:kms:us-east-1:000000000000:key/test";
  __kms.reset();
  _resetDekCache();
  __resetStore();
});

afterEach(() => {
  setNodeEnv(ORIGINAL_NODE_ENV as string);
});

describe("create + read round-trip", () => {
  it("stores a User's encrypted fields as ciphertext only and reads them back", async () => {
    const created = await db.user.create({
      data: { email: "alice@horacemann.org", name: "Alice", image: "https://x/a.png" },
    });

    expect(created.email).toBe("alice@horacemann.org");
    expect(created.name).toBe("Alice");

    const row = storedUser(created.id as string);
    // Plaintext columns are NULL on disk; the envelope columns carry the data.
    expect(row.email).toBeNull();
    expect(row.name).toBeNull();
    expect(row.emailCiphertext).toBeInstanceOf(Buffer);
    expect(row.nameCiphertext).toBeInstanceOf(Buffer);
    expect(row.emailHash).toBeInstanceOf(Buffer);
    expect(row.encryptedDek).toBeInstanceOf(Buffer);
    expect(row.dekKekVersion).toBe(1);
    expect(Buffer.from(row.nameCiphertext as Buffer).toString("utf8")).not.toContain("Alice");

    const read = await db.user.findUnique({ where: { id: created.id } });
    expect(read.name).toBe("Alice");
    expect(read.email).toBe("alice@horacemann.org");
  });

  it("finds a User by email through the blind index", async () => {
    await db.user.create({ data: { email: "bob@horacemann.org", name: "Bob" } });
    const found = await db.user.findUnique({ where: { email: "bob@horacemann.org" } });
    expect(found).not.toBeNull();
    expect(found.name).toBe("Bob");
    const missing = await db.user.findUnique({ where: { email: "nobody@horacemann.org" } });
    expect(missing).toBeNull();
  });

  it("stores an Article's body as ciphertext and reads it back", async () => {
    const created = await db.article.create({
      data: { title: "Hello", slug: "hello", body: "<p>Body text</p>", section: "NEWS" },
    });
    const row = storedArticle(created.id as string);
    expect(row.title).toBe("Hello"); // not an encrypted field
    expect(row.body).toBeNull();
    expect(row.bodyCiphertext).toBeInstanceOf(Buffer);

    const read = await db.article.findUnique({ where: { id: created.id } });
    expect(read.body).toBe("<p>Body text</p>");
    expect(read.title).toBe("Hello");
  });

  it("keeps Date fields as Date instances through the read pipeline", async () => {
    const created = await db.article.create({
      data: { title: "Dated", slug: "dated", body: "<p>x</p>" },
    });
    expect(created.createdAt).toBeInstanceOf(Date);
    const read = await db.article.findUnique({ where: { id: created.id } });
    expect(read.createdAt).toBeInstanceOf(Date);
  });

  it("round-trips a nested create (Article with credits)", async () => {
    const created = await db.article.create({
      data: {
        title: "Nested",
        slug: "nested",
        body: "<p>nested body</p>",
        credits: { create: [{ userId: "u1", creditRole: "Staff Writer" }] },
      },
    });

    const credit = __store.articleCredit[0];
    expect(credit.articleId).toBe(created.id);
    expect(credit.creditRole).toBeNull();
    expect(credit.creditRoleCiphertext).toBeInstanceOf(Buffer);
    expect(credit.creditRoleHash).toBeInstanceOf(Buffer);
    expect(credit.encryptedDek).toBeInstanceOf(Buffer);

    const read = await db.article.findUnique({
      where: { id: created.id },
      include: { credits: true },
    });
    expect(read.body).toBe("<p>nested body</p>");
    expect(read.credits).toHaveLength(1);
    expect(read.credits[0].creditRole).toBe("Staff Writer");
  });
});

describe("update path", () => {
  it("re-reads encrypted fields after a non-encrypted field is updated (DEK cache aliasing)", async () => {
    const created = await db.user.create({
      data: { email: "carol@horacemann.org", name: "Carol" },
    });
    const dekBefore = Buffer.from(storedUser(created.id as string).encryptedDek as Buffer);

    await db.user.update({ where: { id: created.id }, data: { role: "EDITOR" } });

    const read = await db.user.findUnique({ where: { id: created.id } });
    expect(read.name).toBe("Carol");
    expect(read.email).toBe("carol@horacemann.org");
    expect(read.role).toBe("EDITOR");
    // The row's DEK must not have been rotated by an update that touched no encrypted field.
    expect(Buffer.from(storedUser(created.id as string).encryptedDek as Buffer).equals(dekBefore)).toBe(true);
  });

  it("updates an encrypted field in place, reusing the row's existing DEK", async () => {
    const created = await db.article.create({
      data: { title: "T", slug: "t", body: "<p>old</p>", featuredImage: "data:image/png;base64,AAA" },
    });
    const before = storedArticle(created.id as string);
    const dekBefore = Buffer.from(before.encryptedDek as Buffer);
    const featuredBefore = Buffer.from(before.featuredImageCiphertext as Buffer);

    await db.article.update({ where: { id: created.id }, data: { body: "<p>new</p>" } });

    const after = storedArticle(created.id as string);
    expect(Buffer.from(after.encryptedDek as Buffer).equals(dekBefore)).toBe(true);
    // Untouched encrypted columns stay readable under the same DEK.
    expect(Buffer.from(after.featuredImageCiphertext as Buffer).equals(featuredBefore)).toBe(true);

    const read = await db.article.findUnique({ where: { id: created.id } });
    expect(read.body).toBe("<p>new</p>");
    expect(read.featuredImage).toBe("data:image/png;base64,AAA");
  });

  it("refreshes the blind index when a deterministic field is updated", async () => {
    const created = await db.user.create({ data: { email: "dan@horacemann.org", name: "Dan" } });
    await db.user.update({
      where: { id: created.id },
      data: { email: "daniel@horacemann.org" },
    });
    const found = await db.user.findUnique({ where: { email: "daniel@horacemann.org" } });
    expect(found).not.toBeNull();
    expect(found.id).toBe(created.id);
  });

  it("throws and writes nothing when the row's DEK cannot be unwrapped", async () => {
    const created = await db.user.create({ data: { email: "erin@horacemann.org", name: "Erin" } });
    const before = storedUser(created.id as string);
    const nameBefore = Buffer.from(before.nameCiphertext as Buffer);
    const dekBefore = Buffer.from(before.encryptedDek as Buffer);

    _resetDekCache();
    __kms.failDecrypt = true;

    await expect(
      db.user.update({ where: { id: created.id }, data: { name: "Erin Renamed" } }),
    ).rejects.toThrow(EnvelopeError);
    await expect(
      db.user.update({ where: { id: created.id }, data: { name: "Erin Renamed" } }),
    ).rejects.toThrow(/cannot re-key existing row/);

    const after = storedUser(created.id as string);
    expect(Buffer.from(after.nameCiphertext as Buffer).equals(nameBefore)).toBe(true);
    // Above all: the row must NOT have been re-keyed with a fresh DEK.
    expect(Buffer.from(after.encryptedDek as Buffer).equals(dekBefore)).toBe(true);
  });

  it("throws when an encrypted model is updated by something other than id", async () => {
    await db.user.create({ data: { email: "frank@horacemann.org", name: "Frank" } });
    await expect(
      db.user.update({ where: { email: "frank@horacemann.org" }, data: { name: "Franklin" } }),
    ).rejects.toThrow(/must be updated by id/);
    await expect(
      db.user.updateMany({ where: { role: "READER" }, data: { name: "Franklin" } }),
    ).rejects.toThrow(/must be updated by id/);
    // and nothing was written
    expect(__store.user[0].nameCiphertext).toBeInstanceOf(Buffer);
    const read = await db.user.findUnique({ where: { id: __store.user[0].id } });
    expect(read.name).toBe("Frank");
  });
});

describe("nested relation writes", () => {
  it("throws on a nested update of an encrypted relation, and writes nothing", async () => {
    const created = await db.article.create({
      data: {
        title: "Nested update",
        slug: "nested-update",
        body: "<p>body</p>",
        credits: { create: [{ userId: "u1", creditRole: "Staff Writer" }] },
      },
    });
    const creditBefore = Buffer.from(
      __store.articleCredit[0].creditRoleCiphertext as Buffer,
    );

    await expect(
      db.article.update({
        where: { id: created.id },
        data: {
          credits: {
            update: { where: { id: __store.articleCredit[0].id }, data: { creditRole: "Editor" } },
          },
        },
      }),
    ).rejects.toThrow(EnvelopeError);

    await expect(
      db.article.update({
        where: { id: created.id },
        data: { credits: { upsert: { create: { creditRole: "Editor" }, update: {} } } },
      }),
    ).rejects.toThrow(/nested `upsert`/);

    // The plaintext must not have reached the database, and the existing row is untouched.
    expect(
      Buffer.from(__store.articleCredit[0].creditRoleCiphertext as Buffer).equals(creditBefore),
    ).toBe(true);
    expect(__store.articleCredit[0].creditRole).toBeNull();
  });

  it("allows nested link-only operations that carry no field data", async () => {
    const created = await db.article.create({
      data: { title: "Linked", slug: "linked", body: "<p>b</p>" },
    });
    await expect(
      db.article.update({
        where: { id: created.id },
        data: { credits: { deleteMany: {} } },
      }),
    ).resolves.toBeDefined();
  });

  it("throws on a writing operation the envelope path does not implement", async () => {
    await expect(
      db.user.createManyAndReturn({ data: [{ email: "nan@horacemann.org", name: "Nan" }] }),
    ).rejects.toThrow(/createManyAndReturn/);
    expect(__store.user).toHaveLength(0);
  });
});

describe("setting an encrypted field to null", () => {
  it("clears the ciphertext (and hash) instead of leaving stale PII behind", async () => {
    const created = await db.user.create({
      data: { email: "olive@horacemann.org", name: "Olive", image: "data:image/png;base64,AAA" },
    });
    expect(storedUser(created.id as string).imageCiphertext).toBeInstanceOf(Buffer);

    await db.user.update({ where: { id: created.id }, data: { image: null } });

    const row = storedUser(created.id as string);
    expect(row.imageCiphertext).toBeNull();
    // Untouched encrypted columns survive.
    expect(row.nameCiphertext).toBeInstanceOf(Buffer);

    const read = await db.user.findUnique({ where: { id: created.id } });
    expect(read.image).toBeNull();
    expect(read.name).toBe("Olive");
  });
});

describe("write failures are fatal", () => {
  it("throws instead of writing plaintext when GenerateDataKey fails", async () => {
    __kms.failGenerate = true;
    await expect(
      db.user.create({ data: { email: "gina@horacemann.org", name: "Gina" } }),
    ).rejects.toThrow();
    expect(__store.user).toHaveLength(0);
  });
});

describe("read path with a narrow select", () => {
  it("throws outside production, naming the model and field", async () => {
    const created = await db.user.create({ data: { email: "hal@horacemann.org", name: "Hal" } });
    await expect(
      db.user.findUnique({ where: { id: created.id }, select: { id: true, name: true } }),
    ).rejects.toThrow(/User\.name/);
  });

  it("logs and returns null in production", async () => {
    const created = await db.user.create({ data: { email: "ivy@horacemann.org", name: "Ivy" } });
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    setNodeEnv("production");
    const read = await db.user.findUnique({
      where: { id: created.id },
      select: { id: true, name: true },
    });
    expect(read.name).toBeNull();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("does not blame the select when the row itself has no DEK", async () => {
    // A row whose encryptedDek is NULL on disk (pre-envelope leftover / partial write) is a data
    // condition: every column was selected, so the caller's select is not the problem.
    __store.user.push({
      id: "user-no-dek",
      email: null,
      name: null,
      image: null,
      googleImage: null,
      role: "READER",
      isPlaceholder: false,
      emailCiphertext: null,
      emailHash: null,
      nameCiphertext: null,
      imageCiphertext: null,
      encryptedDek: null,
      dekKekVersion: null,
      createdAt: new Date(),
    });
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});

    const read = await db.user.findUnique({ where: { id: "user-no-dek" } });
    expect(read.name).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][0])).not.toContain("the select omits");
    expect(String(spy.mock.calls[0][0])).toContain("no encryptedDek");

    // Logged once per model, not once per row.
    await db.user.findUnique({ where: { id: "user-no-dek" } });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("is happy with a select that carries the envelope columns", async () => {
    const created = await db.user.create({ data: { email: "jo@horacemann.org", name: "Jo" } });
    const read = await db.user.findUnique({
      where: { id: created.id },
      select: { id: true, name: true, nameCiphertext: true, encryptedDek: true },
    });
    expect(read.name).toBe("Jo");
  });

  it("does not complain about a select with no encrypted fields", async () => {
    const created = await db.user.create({ data: { email: "kim@horacemann.org", name: "Kim" } });
    const read = await db.user.findUnique({
      where: { id: created.id },
      select: { id: true, role: true },
    });
    expect(read).toEqual({ id: created.id, role: "READER" });
  });
});

describe("KMS not configured", () => {
  it("leaves the extension inert", async () => {
    delete process.env.KMS_KEY_ARN;
    const created = await db.user.create({ data: { email: "lee@horacemann.org", name: "Lee" } });
    expect(created.name).toBe("Lee");
    expect(__store.user[0].name).toBe("Lee");
    expect(__kms.generateCalls).toBe(0);
  });
});
