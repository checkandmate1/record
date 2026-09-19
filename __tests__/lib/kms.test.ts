// KMS envelope helpers against the in-memory __mocks__/@aws-sdk/client-kms stand-in.
// No AWS calls, no network.

import * as kms from "@/lib/kms";
import type { EncryptionContext } from "@/lib/kms";

// Same module instance lib/kms.ts talks to: __mocks__/@aws-sdk/client-kms.ts is applied
// automatically because it is a manual mock for a node_modules package.
const { __kms } = jest.requireMock("@aws-sdk/client-kms") as {
  __kms: { generateCalls: number; decryptCalls: number; failDecrypt: boolean; reset(): void };
};

const CTX_A: EncryptionContext = { recordType: "User", recordId: "user-a" };
const CTX_B: EncryptionContext = { recordType: "User", recordId: "user-b" };

describe("lib/kms", () => {
  const originalArn = process.env.KMS_KEY_ARN;

  beforeEach(() => {
    process.env.KMS_KEY_ARN = "arn:aws:kms:us-east-1:000000000000:key/test";
    __kms.reset();
    kms._resetDekCache();
  });

  afterEach(() => {
    if (originalArn === undefined) delete process.env.KMS_KEY_ARN;
    else process.env.KMS_KEY_ARN = originalArn;
  });

  it("isKmsConfigured reflects KMS_KEY_ARN", () => {
    expect(kms.isKmsConfigured()).toBe(true);
    delete process.env.KMS_KEY_ARN;
    expect(kms.isKmsConfigured()).toBe(false);
  });

  it("generateDek returns a 32-byte key that unwraps back to itself", async () => {
    const { dek, wrappedDek, kekVersion } = await kms.generateDek(CTX_A);
    expect(dek).toHaveLength(32);
    expect(kekVersion).toBe(1);
    const unwrapped = await kms.unwrapDek(wrappedDek, CTX_A);
    expect(unwrapped.equals(dek)).toBe(true);
  });

  it("caches the plaintext DEK so repeat unwraps under the same context cost one KMS call", async () => {
    const { wrappedDek } = await kms.generateDek(CTX_A);
    await kms.unwrapDek(wrappedDek, CTX_A);
    await kms.unwrapDek(wrappedDek, CTX_A);
    expect(__kms.decryptCalls).toBe(1);
  });

  it("returns a copy, so a caller wiping its DEK does not poison the cache", async () => {
    const { dek, wrappedDek } = await kms.generateDek(CTX_A);
    const first = await kms.unwrapDek(wrappedDek, CTX_A);
    first.fill(0);
    const second = await kms.unwrapDek(wrappedDek, CTX_A);
    expect(second.equals(dek)).toBe(true);
  });

  // Regression: the cache used to be keyed by the wrapped bytes alone, so a wrapped DEK copied
  // onto another row was served straight out of memory without KMS ever checking the context.
  it("keys the cache by encryption context, so a wrapped DEK cannot be replayed on another row", async () => {
    const { wrappedDek } = await kms.generateDek(CTX_A);
    await kms.unwrapDek(wrappedDek, CTX_A);
    const before = __kms.decryptCalls;

    await expect(kms.unwrapDek(wrappedDek, CTX_B)).rejects.toThrow("encryption context mismatch");
    // It must have gone to KMS rather than being answered from the cache.
    expect(__kms.decryptCalls).toBe(before + 1);
  });

  it("_resetDekCache forces a fresh KMS Decrypt", async () => {
    const { wrappedDek } = await kms.generateDek(CTX_A);
    await kms.unwrapDek(wrappedDek, CTX_A);
    kms._resetDekCache();
    await kms.unwrapDek(wrappedDek, CTX_A);
    expect(__kms.decryptCalls).toBe(2);
  });

  it("throws when KMS_KEY_ARN is unset", async () => {
    delete process.env.KMS_KEY_ARN;
    await expect(kms.generateDek(CTX_A)).rejects.toThrow("KMS_KEY_ARN is not set");
  });

  it("propagates KMS Decrypt failures instead of returning a bogus key", async () => {
    const { wrappedDek } = await kms.generateDek(CTX_A);
    __kms.failDecrypt = true;
    await expect(kms.unwrapDek(wrappedDek, CTX_A)).rejects.toThrow("Decrypt failed");
  });
});
