/**
 * One-off: move `Article.featuredImage` values that are base64 `data:` URLs into S3 and rewrite
 * the column to the resulting https URL.
 *
 * Featured images used to be stored inline in Postgres (encrypted, ~1 MB cap). They are S3
 * objects now, like every other upload, and `articleActionSchema` / `createArticleSchema` reject
 * anything that is not a URL in the site's bucket — so any row still holding a data URL can no
 * longer be saved from the dashboard without re-picking the image. This script converts them.
 *
 *   - reads every Article through `../lib/prisma` (the envelope extension decrypts
 *     `featuredImage`; a narrow select must carry the envelope columns — lib/CLAUDE.md)
 *   - uploads the decoded bytes to `uploads/migrated/<articleId>.<ext>`
 *   - updates the row **by id** (the envelope write path binds the KMS context from `where.id`)
 *
 * Idempotent: rows whose `featuredImage` is empty or already an https URL are skipped, so
 * re-running only picks up what is left. Nothing is deleted from S3 or from the DB.
 *
 * Safety: refuses to run unless `DATABASE_URL` points at localhost, or `ALLOW_PROD=1` is set.
 * Run it on staging before production.
 *
 * Usage:
 *
 *   DATABASE_URL=postgresql://localhost:5432/record_local \
 *     npx ts-node -r dotenv/config -r tsconfig-paths/register \
 *     --compiler-options '{"module":"CommonJS"}' \
 *     scripts/migrate-featured-images-to-s3.ts [--dry-run]
 *
 * Needs the same env as the app: `KMS_KEY_ARN` + AWS credentials (KMS GenerateDataKey/Decrypt and
 * S3 PutObject on `uploads/*`), `ENCRYPTION_KEY`, `AWS_S3_BUCKET`, `AWS_REGION`.
 */

import { prisma } from "../lib/prisma";
import { putS3Object, getPublicUrl } from "../lib/s3";

const BATCH_SIZE = 50;

// image/<x> → file extension. Only the types POST /api/upload mints are accepted; anything else
// is reported and left alone rather than guessed at.
const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

// Any select that returns an encrypted field must carry the envelope columns or the field comes
// back NULL (lib/CLAUDE.md).
const SELECT = {
  id: true,
  slug: true,
  featuredImage: true,
  encryptedDek: true,
  dekKekVersion: true,
  featuredImageCiphertext: true,
} as const;

type Row = { id: string; slug: string; featuredImage: string | null };

function maskDatabaseUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = "***";
    return parsed.toString();
  } catch {
    return "<unparseable DATABASE_URL>";
  }
}

function isLocalDatabase(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

/** Splits `data:image/png;base64,AAAA` into its media type and bytes. */
function parseDataUrl(value: string): { contentType: string; bytes: Buffer } | null {
  const comma = value.indexOf(",");
  if (comma === -1) return null;
  const meta = value.slice("data:".length, comma);
  const [contentType, ...params] = meta.split(";");
  if (!contentType?.startsWith("image/")) return null;
  if (!params.includes("base64")) return null;

  const bytes = Buffer.from(value.slice(comma + 1), "base64");
  if (bytes.length === 0) return null;
  return { contentType: contentType.toLowerCase(), bytes };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }
  console.log(`Database: ${maskDatabaseUrl(databaseUrl)}`);

  if (!isLocalDatabase(databaseUrl) && process.env.ALLOW_PROD !== "1") {
    console.error(
      "Refusing to run: DATABASE_URL is not local. Re-run with ALLOW_PROD=1 if that is intended."
    );
    process.exit(1);
  }

  for (const name of ["AWS_S3_BUCKET", "AWS_REGION", "KMS_KEY_ARN"]) {
    if (!process.env[name]) {
      console.error(`${name} is not set.`);
      process.exit(1);
    }
  }

  console.log(dryRun ? "Mode: dry run (no writes)" : "Mode: live");

  let skip = 0;
  let scanned = 0;
  let migrated = 0;
  let failed = 0;

  for (;;) {
    // `featuredImage` is random-encrypted, so a data-URL prefix cannot be filtered in SQL —
    // every row is read and matched in memory.
    const rows = (await prisma.article.findMany({
      select: SELECT,
      orderBy: { createdAt: "asc" },
      skip,
      take: BATCH_SIZE,
    })) as unknown as Row[];
    if (rows.length === 0) break;
    skip += rows.length;
    scanned += rows.length;

    for (const row of rows) {
      const current = row.featuredImage;
      if (!current || !current.startsWith("data:")) continue;

      const parsed = parseDataUrl(current);
      if (!parsed) {
        console.error(`  ✗ ${row.slug}: featuredImage is a data: URL this script cannot decode`);
        failed++;
        continue;
      }

      const ext = EXTENSIONS[parsed.contentType];
      if (!ext) {
        console.error(`  ✗ ${row.slug}: unsupported image type ${parsed.contentType}`);
        failed++;
        continue;
      }

      const key = `uploads/migrated/${row.id}.${ext}`;
      const url = getPublicUrl(key);
      const kb = Math.round(parsed.bytes.length / 1024);

      if (dryRun) {
        console.log(`  [dry-run] ${row.slug}: ${kb} KB ${parsed.contentType} → ${key}`);
        migrated++;
        continue;
      }

      try {
        await putS3Object(key, parsed.bytes, parsed.contentType);
        // where: { id } — the envelope write path binds the KMS context from the id; any other
        // predicate silently skips encryption (lib/CLAUDE.md).
        await prisma.article.update({ where: { id: row.id }, data: { featuredImage: url } });
        console.log(`  ✓ ${row.slug}: ${kb} KB → ${key}`);
        migrated++;
      } catch (err) {
        console.error(`  ✗ ${row.slug} failed: ${(err as Error).message}`);
        failed++;
      }
    }
  }

  console.log(
    `${dryRun ? "[dry-run] " : ""}Done. ${scanned} article(s) scanned, ${migrated} ${
      dryRun ? "would be " : ""
    }migrated, ${failed} failed.`
  );

  await prisma.$disconnect();
  if (failed > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error("Migration failed:", err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
