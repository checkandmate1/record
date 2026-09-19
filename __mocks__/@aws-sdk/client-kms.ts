// In-memory stand-in for @aws-sdk/client-kms.
//
// Jest picks this up automatically for every test (manual mocks for node_modules packages do not
// need an explicit jest.mock() call), so no test ever talks to real AWS KMS.
//
// The fake "wrapped DEK" is a self-describing blob that carries both the plaintext key and the
// EncryptionContext it was generated under. Decrypt refuses to unwrap it under a different
// context, which is what real KMS does and what makes the context-binding tests meaningful.

import { randomBytes } from "crypto";

export type EncryptionContextMap = Record<string, string>;

function canonicalContext(ctx: EncryptionContextMap | undefined): string {
  if (!ctx) return "";
  return Object.keys(ctx)
    .sort()
    .map((k) => `${k}=${ctx[k]}`)
    .join("&");
}

export class GenerateDataKeyCommand {
  constructor(
    public readonly input: {
      KeyId?: string;
      KeySpec?: string;
      EncryptionContext?: EncryptionContextMap;
    },
  ) {}
}

export class DecryptCommand {
  constructor(
    public readonly input: {
      CiphertextBlob?: Uint8Array;
      EncryptionContext?: EncryptionContextMap;
    },
  ) {}
}

export type KmsMockControl = {
  /** Number of GenerateDataKey calls since the last reset. */
  generateCalls: number;
  /** Number of Decrypt calls since the last reset (cache hits never reach here). */
  decryptCalls: number;
  /** When true, every GenerateDataKey rejects — simulates a KMS outage/throttle. */
  failGenerate: boolean;
  /** When true, every Decrypt rejects — simulates a KMS outage/throttle or a revoked grant. */
  failDecrypt: boolean;
  reset(): void;
};

// Test control surface. Import with
//   const { __kms } = jest.requireMock("@aws-sdk/client-kms");
//
// It lives on globalThis because Jest can hand the module under test and the test file different
// instances of this file (manual-mock resolution vs. jest.requireMock); a module-local object would
// leave the test toggling a copy nobody reads.
const globalKey = "__recordKmsMockControl__";
const g = globalThis as unknown as Record<string, KmsMockControl | undefined>;

export const __kms: KmsMockControl =
  g[globalKey] ??
  (g[globalKey] = {
    generateCalls: 0,
    decryptCalls: 0,
    failGenerate: false,
    failDecrypt: false,
    reset(): void {
      this.generateCalls = 0;
      this.decryptCalls = 0;
      this.failGenerate = false;
      this.failDecrypt = false;
    },
  });

type AnyCommand = GenerateDataKeyCommand | DecryptCommand;

export class KMSClient {
  constructor(public readonly config: unknown = {}) {}

  async send(
    command: AnyCommand,
  ): Promise<{ Plaintext?: Uint8Array; CiphertextBlob?: Uint8Array }> {
    if (command instanceof GenerateDataKeyCommand) {
      __kms.generateCalls += 1;
      if (__kms.failGenerate) {
        throw new Error("KMSInternalException: GenerateDataKey failed (mock)");
      }
      if (!command.input.KeyId) throw new Error("ValidationException: KeyId is required");
      const plaintext = randomBytes(32);
      const blob = Buffer.from(
        JSON.stringify({
          k: plaintext.toString("base64"),
          c: canonicalContext(command.input.EncryptionContext),
        }),
        "utf8",
      );
      return { Plaintext: new Uint8Array(plaintext), CiphertextBlob: new Uint8Array(blob) };
    }

    if (command instanceof DecryptCommand) {
      __kms.decryptCalls += 1;
      if (__kms.failDecrypt) {
        throw new Error("KMSInternalException: Decrypt failed (mock)");
      }
      const blob = command.input.CiphertextBlob;
      if (!blob) throw new Error("ValidationException: CiphertextBlob is required");
      let parsed: { k?: string; c?: string };
      try {
        parsed = JSON.parse(Buffer.from(blob).toString("utf8")) as { k?: string; c?: string };
      } catch {
        throw new Error("InvalidCiphertextException: not a mock KMS blob");
      }
      if (!parsed.k) throw new Error("InvalidCiphertextException: malformed mock KMS blob");
      if (parsed.c !== canonicalContext(command.input.EncryptionContext)) {
        throw new Error("InvalidCiphertextException: encryption context mismatch");
      }
      return { Plaintext: new Uint8Array(Buffer.from(parsed.k, "base64")) };
    }

    throw new Error("Unsupported KMS command in mock");
  }
}
