// lib/encryption.ts is deliberately stateful (it self-initializes from process.env.ENCRYPTION_KEY
// at import so every Next chunk-local copy has a pepper). next/jest loads .env into process.env,
// so a test that relies on the "no key" state MUST get a fresh module registry with the env var
// removed — otherwise it passes or fails depending on whether the developer has a .env file.
// Every test below therefore loads the module through loadEncryption().

import { randomBytes } from "crypto";

type EncryptionModule = typeof import("@/lib/encryption");

const TEST_KEY = randomBytes(32).toString("hex");

function loadEncryption(): EncryptionModule {
  let mod!: EncryptionModule;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require("@/lib/encryption") as EncryptionModule;
  });
  return mod;
}

const ORIGINAL_KEY = process.env.ENCRYPTION_KEY;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

function setNodeEnv(value: string) {
  Object.defineProperty(process.env, "NODE_ENV", { value, writable: true, configurable: true });
}

beforeEach(() => {
  jest.resetModules();
  delete process.env.ENCRYPTION_KEY;
});

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = ORIGINAL_KEY;
  setNodeEnv(ORIGINAL_NODE_ENV as string);
});

describe("initEncryption / isEncryptionEnabled", () => {
  it("is disabled until a key is provided", () => {
    const mod = loadEncryption();
    expect(mod.isEncryptionEnabled()).toBe(false);
  });

  it("self-initializes from process.env.ENCRYPTION_KEY at import", () => {
    process.env.ENCRYPTION_KEY = TEST_KEY;
    const mod = loadEncryption();
    expect(mod.isEncryptionEnabled()).toBe(true);
  });

  it("rejects a key that is not 32 bytes", () => {
    const mod = loadEncryption();
    expect(() => mod.initEncryption("abcd")).toThrow("32 bytes");
  });
});

describe("envelope primitives (encryptWithKey / decryptWithKey)", () => {
  const dek = randomBytes(32);

  it("round-trips a string", () => {
    const mod = loadEncryption();
    const buf = mod.encryptWithKey("Hello, World!", dek);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.toString("utf8")).not.toContain("Hello");
    expect(mod.decryptWithKey(buf, dek)).toBe("Hello, World!");
  });

  it("round-trips unicode and empty strings", () => {
    const mod = loadEncryption();
    expect(mod.decryptWithKey(mod.encryptWithKey("Hello 🌍 世界", dek), dek)).toBe("Hello 🌍 世界");
    expect(mod.decryptWithKey(mod.encryptWithKey("", dek), dek)).toBe("");
  });

  it("uses a random IV, so the same plaintext encrypts differently every time", () => {
    const mod = loadEncryption();
    const a = mod.encryptWithKey("same input", dek);
    const b = mod.encryptWithKey("same input", dek);
    expect(a.equals(b)).toBe(false);
    expect(mod.decryptWithKey(a, dek)).toBe("same input");
    expect(mod.decryptWithKey(b, dek)).toBe("same input");
  });

  it("fails authentication under the wrong DEK", () => {
    const mod = loadEncryption();
    const buf = mod.encryptWithKey("secret", dek);
    expect(() => mod.decryptWithKey(buf, randomBytes(32))).toThrow();
  });

  it("fails authentication on tampered ciphertext", () => {
    const mod = loadEncryption();
    const buf = mod.encryptWithKey("secret", dek);
    buf[buf.length - 1] ^= 0xff;
    expect(() => mod.decryptWithKey(buf, dek)).toThrow();
  });

  it("requires a 32-byte DEK", () => {
    const mod = loadEncryption();
    expect(() => mod.encryptWithKey("x", randomBytes(16))).toThrow("32 bytes");
    expect(() => mod.decryptWithKey(Buffer.alloc(40), randomBytes(16))).toThrow("32 bytes");
  });
});

describe("blindIndex", () => {
  it("is deterministic for the same pepper and input", () => {
    process.env.ENCRYPTION_KEY = TEST_KEY;
    const mod = loadEncryption();
    expect(mod.blindIndex("a@horacemann.org").equals(mod.blindIndex("a@horacemann.org"))).toBe(true);
    expect(mod.blindIndex("a@horacemann.org").equals(mod.blindIndex("b@horacemann.org"))).toBe(false);
  });

  it("changes when the pepper changes", () => {
    process.env.ENCRYPTION_KEY = TEST_KEY;
    const a = loadEncryption().blindIndex("a@horacemann.org");
    jest.resetModules();
    process.env.ENCRYPTION_KEY = randomBytes(32).toString("hex");
    const b = loadEncryption().blindIndex("a@horacemann.org");
    expect(a.equals(b)).toBe(false);
  });

  it("returns a dev stand-in when no pepper is configured outside production", () => {
    const mod = loadEncryption();
    expect(mod.isEncryptionEnabled()).toBe(false);
    expect(mod.blindIndex("a@horacemann.org")).toHaveLength(32);
  });

  it("throws in production when no pepper is configured", () => {
    const mod = loadEncryption();
    setNodeEnv("production");
    expect(() => mod.blindIndex("a@horacemann.org")).toThrow("Blind index key not initialized");
  });

  it("throws in production after markEncryptionInitFailed, even with a pepper in env", () => {
    process.env.ENCRYPTION_KEY = TEST_KEY;
    const mod = loadEncryption();
    jest.spyOn(console, "error").mockImplementation(() => {});
    mod.markEncryptionInitFailed("secrets manager unreachable");
    setNodeEnv("production");
    expect(() => mod.blindIndex("a@horacemann.org")).toThrow("refusing");
    jest.restoreAllMocks();
  });
});

describe("EnvelopeError", () => {
  it("is an Error subclass named EnvelopeError", () => {
    const mod = loadEncryption();
    const err = new mod.EnvelopeError("boom");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("EnvelopeError");
    expect(err.message).toBe("boom");
  });
});

describe("legacy enc:v1: path", () => {
  it("is gone — no encrypt/decrypt exports remain", () => {
    const mod = loadEncryption() as unknown as Record<string, unknown>;
    expect(mod.encrypt).toBeUndefined();
    expect(mod.decrypt).toBeUndefined();
  });
});

describe("ENCRYPTED_FIELDS config", () => {
  it("matches the schema's envelope columns", () => {
    const { ENCRYPTED_FIELDS } = loadEncryption();
    expect(ENCRYPTED_FIELDS.User).toEqual({
      email: "deterministic",
      name: "random",
      image: "random",
    });
    expect(ENCRYPTED_FIELDS.Article).toEqual({ body: "random", featuredImage: "random" });
    expect(ENCRYPTED_FIELDS.ArticleCredit).toEqual({ creditRole: "deterministic" });
    expect(ENCRYPTED_FIELDS.ArticleImage).toEqual({
      url: "random",
      caption: "random",
      altText: "random",
    });
    expect(ENCRYPTED_FIELDS.RoundTable).toEqual({ prompt: "random" });
    expect(ENCRYPTED_FIELDS.RoundTableSide).toEqual({ label: "random" });
    expect(ENCRYPTED_FIELDS.RoundTableTurn).toEqual({ body: "random" });
  });
});
