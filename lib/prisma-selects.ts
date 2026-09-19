// Common Prisma select shapes that include the envelope-encryption metadata required for
// lib/prisma's extension to decrypt the values at runtime. Without these columns in a select,
// the User/Article/etc. row lacks the wrapped DEK and the extension can't synthesize plaintext.
//
// `id` is mandatory in every shape, including nested ones: applyEnvelopeRead (lib/prisma.ts)
// keys the KMS encryption context on it and silently skips decryption without it — the same
// failure mode as a missing `encryptedDek`/`<field>Ciphertext`, just easier to miss because
// `id` looks unrelated to encryption.
//
// Use these instead of hand-writing `select: { id: true, name: true, ... }` for encrypted models.

export const userPublicSelect = {
  id: true,
  name: true,
  image: true,
  role: true,
  displayTitle: true,
  encryptedDek: true,
  dekKekVersion: true,
  nameCiphertext: true,
  imageCiphertext: true,
} as const;

export const userPublicWithEmailSelect = {
  ...userPublicSelect,
  email: true,
  emailCiphertext: true,
} as const;

export const userMinimalNameSelect = {
  id: true,
  name: true,
  encryptedDek: true,
  dekKekVersion: true,
  nameCiphertext: true,
} as const;

export const userMinimalNameImageSelect = {
  id: true,
  name: true,
  image: true,
  encryptedDek: true,
  dekKekVersion: true,
  nameCiphertext: true,
  imageCiphertext: true,
} as const;

// ---- Article ----
// Article has random-encrypted body and (nullable) featuredImage. Any select that pulls back
// either field MUST include the envelope columns or the field comes back NULL on disk and the
// extension can't decrypt → callers blow up on `body.replace(...)` etc.

export const articleListSelect = {
  id: true,
  title: true,
  slug: true,
  section: true,
  body: true,
  featuredImage: true,
  createdAt: true,
  encryptedDek: true,
  dekKekVersion: true,
  bodyCiphertext: true,
  featuredImageCiphertext: true,
} as const;

// For places that just need the body for preview generation.
export const articleBodySelect = {
  id: true,
  title: true,
  section: true,
  body: true,
  encryptedDek: true,
  dekKekVersion: true,
  bodyCiphertext: true,
} as const;

// ---- ArticleCredit ----
// Use as `credits: { select: articleCreditSelect }` wherever the ArticleCredit relation is
// narrowed with an explicit `select` (rather than `include`, which returns every ArticleCredit
// scalar — envelope columns included — by default). creditRole is deterministic-encrypted.

export const articleCreditSelect = {
  id: true,
  creditRole: true,
  encryptedDek: true,
  dekKekVersion: true,
  creditRoleCiphertext: true,
  user: { select: userMinimalNameSelect },
} as const;

// ---- RoundTable ----
// A RoundTable plus its sides/authors, for dashboard summaries. prompt (RoundTable) and label
// (RoundTableSide) are both random-encrypted, so each level needs its own envelope columns.

export const roundTableSummarySelect = {
  id: true,
  slug: true,
  prompt: true,
  encryptedDek: true,
  dekKekVersion: true,
  promptCiphertext: true,
  sides: {
    orderBy: { order: "asc" as const },
    select: {
      id: true,
      label: true,
      encryptedDek: true,
      dekKekVersion: true,
      labelCiphertext: true,
      authors: { select: { user: { select: userMinimalNameSelect } } },
    },
  },
  turns: { select: { id: true } },
} as const;
