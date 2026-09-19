// Structural tripwire: every select shape in lib/prisma-selects.ts — including nested relation
// selects — must carry `id`, `encryptedDek`, `dekKekVersion`, and a `<field>Ciphertext` for every
// encrypted field it names. Missing `id` is easy to miss because it looks unrelated to
// encryption, but lib/prisma.ts's applyEnvelopeRead keys the KMS decryption context on it and
// silently skips decryption without it (same failure mode as a missing `encryptedDek`).
import {
  userPublicSelect,
  userPublicWithEmailSelect,
  userMinimalNameSelect,
  userMinimalNameImageSelect,
  articleListSelect,
  articleBodySelect,
  articleCreditSelect,
  roundTableSummarySelect,
} from "@/lib/prisma-selects";

// A select shape is "envelope-complete" if, for every `<field>Ciphertext` key present, the shape
// also has `id`, `encryptedDek`, and `dekKekVersion` — the four things applyEnvelopeRead needs to
// decrypt that field.
function expectEnvelopeComplete(shape: Record<string, unknown>, label: string) {
  const ciphertextKeys = Object.keys(shape).filter((k) => k.endsWith("Ciphertext"));
  if (ciphertextKeys.length === 0) return; // nothing encrypted selected at this level
  expect({ label, hasId: "id" in shape }).toEqual({ label, hasId: true });
  expect(shape.encryptedDek).toBe(true);
  expect(shape.dekKekVersion).toBe(true);
  for (const key of ciphertextKeys) {
    expect(shape[key]).toBe(true);
  }
}

describe("prisma-selects envelope completeness", () => {
  it("userPublicSelect", () => {
    expectEnvelopeComplete(userPublicSelect, "userPublicSelect");
  });

  it("userPublicWithEmailSelect", () => {
    expectEnvelopeComplete(userPublicWithEmailSelect, "userPublicWithEmailSelect");
  });

  it("userMinimalNameSelect", () => {
    expectEnvelopeComplete(userMinimalNameSelect, "userMinimalNameSelect");
  });

  it("userMinimalNameImageSelect", () => {
    expectEnvelopeComplete(userMinimalNameImageSelect, "userMinimalNameImageSelect");
  });

  it("articleListSelect", () => {
    expectEnvelopeComplete(articleListSelect, "articleListSelect");
  });

  it("articleBodySelect", () => {
    expectEnvelopeComplete(articleBodySelect, "articleBodySelect");
  });

  it("articleCreditSelect (top level and nested user)", () => {
    expectEnvelopeComplete(articleCreditSelect, "articleCreditSelect");
    expectEnvelopeComplete(articleCreditSelect.user.select, "articleCreditSelect.user");
  });

  it("roundTableSummarySelect (top level, nested sides, and nested side authors' user)", () => {
    expectEnvelopeComplete(roundTableSummarySelect, "roundTableSummarySelect");
    expectEnvelopeComplete(roundTableSummarySelect.sides.select, "roundTableSummarySelect.sides");
    expectEnvelopeComplete(
      roundTableSummarySelect.sides.select.authors.select.user.select,
      "roundTableSummarySelect.sides.authors.user"
    );
  });

  // Regression guards for the two specific bugs found in review: a shape that selects a
  // `<field>Ciphertext` column but not `id` decrypts to null silently, with no type error.
  it("articleCreditSelect selects id", () => {
    expect(articleCreditSelect.id).toBe(true);
  });

  it("roundTableSummarySelect.sides selects id", () => {
    expect(roundTableSummarySelect.sides.select.id).toBe(true);
  });
});
