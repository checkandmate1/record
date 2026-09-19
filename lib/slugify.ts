import slugifyLib from "slugify";
import { prisma } from "@/lib/prisma";

/**
 * Slug minting for `Article.slug` and `RoundTable.slug` (both UNIQUE).
 *
 * The old implementation looped `findFirst({ where: { slug } })` until it missed, which is
 * an unbounded N+1 on a hot path. Both helpers now issue exactly one `findMany` prefixed on
 * the base slug and pick the first free suffix in memory.
 *
 * This is still check-then-insert: two concurrent creates can agree on the same free slug and
 * the loser gets a Prisma P2002. Callers that insert should wrap the write in
 * `insertWithSlugRetry`, which retries once with a random 4-character suffix.
 */

const SLUG_OPTIONS = { lower: true, strict: true } as const;

/** Fallback when a title slugifies to nothing (empty, whitespace- or symbol-only). */
const ARTICLE_FALLBACK = "untitled";
const ROUND_TABLE_FALLBACK = "round-table";

function baseSlug(title: string | null | undefined, fallback: string): string {
  return slugifyLib(String(title ?? ""), SLUG_OPTIONS) || fallback;
}

/**
 * `base`, else `base-2`, `base-3`, … — the FIRST free suffix, so deleting `-2` lets the next
 * article reuse it. `taken` may contain unrelated slugs that merely share the prefix
 * (`hello-world-cup` for base `hello-world`); those never match a candidate, so they are inert.
 */
function firstFreeSlug(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  // At most `taken.size + 1` candidates can be occupied, so this always terminates.
  for (let n = 2; n <= taken.size + 2; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  /* istanbul ignore next — unreachable given the bound above */
  return withRandomSuffix(base);
}

type SlugRow = { slug: string | null };

function takenSlugs(rows: SlugRow[]): Set<string> {
  return new Set(rows.map((r) => r.slug).filter((s): s is string => typeof s === "string"));
}

function collisionWhere(base: string, excludeId?: string) {
  return excludeId
    ? { slug: { startsWith: base }, NOT: { id: excludeId } }
    : { slug: { startsWith: base } };
}

/**
 * @param excludeId row being updated — its own slug must not count as a collision, otherwise
 *   re-saving an article under the same title gratuitously bumps it to `-2`.
 */
export async function generateUniqueSlug(title: string, excludeId?: string): Promise<string> {
  const base = baseSlug(title, ARTICLE_FALLBACK);
  const rows = await prisma.article.findMany({
    where: collisionWhere(base, excludeId),
    select: { slug: true },
  });
  return firstFreeSlug(base, takenSlugs(rows));
}

/** @param excludeId see {@link generateUniqueSlug}. */
export async function generateUniqueRoundTableSlug(
  title: string,
  excludeId?: string,
): Promise<string> {
  const base = baseSlug(title, ROUND_TABLE_FALLBACK);
  const rows = await prisma.roundTable.findMany({
    where: collisionWhere(base, excludeId),
    select: { slug: true },
  });
  return firstFreeSlug(base, takenSlugs(rows));
}

const RANDOM_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/**
 * Replace (not stack) a trailing 4-character random suffix. Used when an insert lost the race
 * for a slug that was free when we checked.
 */
export function withRandomSuffix(slug: string): string {
  const stripped = slug.replace(/-[a-z0-9]{4}$/, "");
  let suffix = "";
  for (let i = 0; i < 4; i++) {
    suffix += RANDOM_ALPHABET[Math.floor(Math.random() * RANDOM_ALPHABET.length)];
  }
  return `${stripped}-${suffix}`;
}

/** True for a Prisma unique-constraint violation (P2002) on a `slug` column. */
export function isSlugConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, meta } = error as { code?: unknown; meta?: { target?: unknown } };
  if (code !== "P2002") return false;
  const target = meta?.target;
  if (Array.isArray(target)) return target.includes("slug");
  if (typeof target === "string") return target.includes("slug");
  return false;
}

/**
 * Run an insert that writes `slug`; on a slug-only P2002 (someone else took it between the
 * `findMany` above and this write) retry ONCE with a random suffix. Anything else propagates.
 */
export async function insertWithSlugRetry<T>(
  slug: string,
  insert: (slug: string) => Promise<T>,
): Promise<T> {
  try {
    return await insert(slug);
  } catch (error) {
    if (!isSlugConflict(error)) throw error;
    return await insert(withRandomSuffix(slug));
  }
}
