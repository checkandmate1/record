import type { BinaryLike } from "crypto";

function getCrypto() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("crypto") as typeof import("crypto");
}

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

// The HMAC pepper for blind indexes (User.emailHash, ArticleCredit.creditRoleHash). Despite the
// env var being called ENCRYPTION_KEY, this is the ONLY thing it still does: bulk content is
// encrypted with per-row KMS-wrapped DEKs (lib/kms.ts), never with this key.
let encryptionKey: Buffer | null = null;
let blindIndexKey: Buffer | null = null;
// Tracks whether instrumentation tried to initialize the key and failed. When set in production,
// every crypto operation throws so DB ops fail loudly instead of silently writing unpeppered data.
let initFailed = false;

// Thrown by the envelope pipeline (lib/prisma.ts) and by this module when a crypto invariant is
// violated. Named exactly "EnvelopeError" so call sites can catch it by name/instance.
export class EnvelopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvelopeError";
  }
}

export function markEncryptionInitFailed(reason: string): void {
  initFailed = true;
  console.error(`[encryption] initialization failed: ${reason}`);
}

export function initEncryption(hexKey: string): void {
  initFailed = false;
  const key = Buffer.from(hexKey, "hex");
  if (key.length !== 32) {
    throw new Error("Encryption key must be 32 bytes (64 hex characters)");
  }
  encryptionKey = key;
  blindIndexKey = Buffer.from(
    getCrypto().createHmac("sha256", key).update("blind-index-v1").digest()
  );
}

export function isEncryptionEnabled(): boolean {
  return encryptionKey !== null;
}

// ---- Envelope-encryption primitives (KMS migration Phase 2+) ----
//
// These take an explicit per-row DEK (provided by lib/kms.ts) instead of the singleton
// encryptionKey. Output is binary (Buffer) — meant to land in BYTEA columns. Format:
//   [12-byte IV][ciphertext][16-byte auth tag]

export function encryptWithKey(plaintext: string, dek: Buffer): Buffer {
  if (dek.length !== 32) throw new Error("DEK must be 32 bytes for AES-256-GCM");
  const iv = getCrypto().randomBytes(IV_LENGTH);
  const cipher = getCrypto().createCipheriv(ALGORITHM, dek, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, encrypted, authTag]);
}

export function decryptWithKey(buf: Buffer, dek: Buffer): string {
  if (dek.length !== 32) throw new Error("DEK must be 32 bytes for AES-256-GCM");
  // An empty plaintext is legitimate (e.g. an ArticleImage.altText of ""), so exactly
  // IV + tag is a valid buffer.
  if (buf.length < IV_LENGTH + AUTH_TAG_LENGTH) throw new Error("Ciphertext too short");
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(buf.length - AUTH_TAG_LENGTH);
  const ct = buf.subarray(IV_LENGTH, buf.length - AUTH_TAG_LENGTH);
  const decipher = getCrypto().createDecipheriv(ALGORITHM, dek, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

// HMAC-SHA256 over normalized plaintext. Used for equality lookups on encrypted fields
// (User.emailHash, ArticleCredit.creditRoleHash). Plaintext is lowercased for email parity
// with the existing case-insensitive Google OAuth lookup; pass already-normalized values for
// fields where casing matters.
export function blindIndex(plaintext: string): Buffer {
  // Production safety: if instrumentation flagged init as failed, refuse to operate so the bug
  // surfaces as 500s on every DB read/write instead of silently hashing under the wrong pepper
  // (which would orphan every existing row).
  if (process.env.NODE_ENV === "production" && initFailed) {
    throw new EnvelopeError("Encryption not initialized; refusing to blind-index in production");
  }
  if (!blindIndexKey) {
    if (process.env.NODE_ENV === "production") {
      throw new EnvelopeError("Blind index key not initialized");
    }
    // Dev mode without ENCRYPTION_KEY: return a deterministic stand-in so the path doesn't blow up
    // on local DBs that aren't using encryption. Production refuses above.
    return getCrypto().createHash("sha256").update("dev:" + plaintext).digest();
  }
  return getCrypto().createHmac("sha256", blindIndexKey as BinaryLike).update(plaintext).digest();
}

// Self-initialize at module load time. instrumentation.ts also calls initEncryption(), but
// Next.js's bundler can split this module across chunks (instrumentation gets one copy, the
// Prisma extension gets another). Each copy needs its own init or blindIndex() throws on use.
// Reading process.env directly here makes every chunk-local copy self-sufficient.
//
// Production must have ENCRYPTION_KEY set; dev tolerates missing key (encryption becomes a
// passthrough). Secrets-Manager-sourced keys still need instrumentation.ts to populate the env
// var before this module loads — practically that means populating it via .env / pm2 config.
if (process.env.ENCRYPTION_KEY && !encryptionKey) {
  try {
    initEncryption(process.env.ENCRYPTION_KEY);
  } catch (err) {
    markEncryptionInitFailed(`module-load init: ${(err as Error).message}`);
  }
}

export type EncryptionMode = "deterministic" | "random";

export const ENCRYPTED_FIELDS: Record<string, Record<string, EncryptionMode>> = {
  User: {
    email: "deterministic",
    name: "random",
    image: "random",
  },
  Article: {
    body: "random",
    featuredImage: "random",
  },
  ArticleCredit: {
    creditRole: "deterministic",
  },
  ArticleImage: {
    url: "random",
    caption: "random",
    altText: "random",
  },
  RoundTable: {
    prompt: "random",
  },
  RoundTableSide: {
    label: "random",
  },
  RoundTableTurn: {
    body: "random",
  },
};
