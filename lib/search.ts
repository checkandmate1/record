import { prisma } from "@/lib/prisma";
import { userMinimalNameSelect } from "@/lib/prisma-selects";
import { sanitizeHtml } from "@/lib/sanitize";

// Results carry a short excerpt, never the full decrypted body: 30 article bodies is megabytes
// of JSON for a list view that shows two lines of each.
export const SEARCH_EXCERPT_MAX = 300;

// Queries longer than this can't match anything useful and only widen the surface of the
// `contains` scan. Capped here so both callers (the page and GET /api/search) inherit it.
export const SEARCH_QUERY_MAX = 100;

// One search result, discriminated by `kind`. Articles and print-issue PDFs are interleaved
// in a single list (most-recent first), so the client renders each row by its kind.
export type SearchResultItem =
  | {
      kind: "article";
      id: string;
      title: string;
      slug: string;
      excerpt: string;
      section: string;
      publishedAt: string | null;
      authorName: string;
      authorId: string;
    }
  | {
      kind: "issue";
      id: string;
      title: string; // derived "Issue X · Volume X"
      publishedAt: string | null;
    };

// Human/searchable label for an issue PDF, derived from its volume + issue numbers, falling
// back to the group name then the uploaded filename. Single source of truth so the search
// match and the displayed title never drift. Searching "Issue 26", "26", or "Volume 123"
// all hit this string.
export function issueLabel(g: {
  volumeNumber: number | null;
  issueNumber: number | null;
  name: string | null;
  pdfFilename: string | null;
}): string {
  const parts: string[] = [];
  if (g.issueNumber != null) parts.push(`Issue ${g.issueNumber}`);
  if (g.volumeNumber != null) parts.push(`Volume ${g.volumeNumber}`);
  if (parts.length > 0) return parts.join(" · ");
  if (g.name) return g.name;
  return g.pdfFilename ?? "Issue PDF";
}

// Tag-stripped, length-bounded preview of a body. Uses `sanitizeHtml` rather than
// `getPreviewText`, whose `stripHtml` still carries the old greedy `/<[^>]*>/g` and would eat
// "x < y and z > w" out of the excerpt. Truncation reserves room for the ellipsis so the result
// is `SEARCH_EXCERPT_MAX` characters *including* it, instead of having it clamped back off.
function toExcerpt(body: string | null): string {
  const plain = sanitizeHtml(body ?? "").replace(/\s+/g, " ").trim();
  if (plain.length <= SEARCH_EXCERPT_MAX) return plain;
  return plain.slice(0, SEARCH_EXCERPT_MAX - 1).replace(/\s+\S*$/, "") + "…";
}

export async function searchAll(query: string): Promise<SearchResultItem[]> {
  const q = query.trim().slice(0, SEARCH_QUERY_MAX);
  if (!q) return [];

  const [articles, issueGroups] = await Promise.all([
    prisma.article.findMany({
      // Title only. `body` is random-mode encrypted, so the legacy plaintext column is NULL for
      // every row — a `{ body: { contains } }` branch matches nothing and raises nothing.
      where: {
        group: { status: "PUBLISHED" },
        title: { contains: q, mode: "insensitive" },
      },
      orderBy: { group: { publishedAt: "desc" } },
      take: 30,
      include: {
        createdBy: { select: userMinimalNameSelect },
        credits: { include: { user: { select: userMinimalNameSelect } } },
        group: { select: { publishedAt: true } },
      },
    }),
    // Published issues that actually have a PDF. One row per issue (a small table), so we fetch
    // all of them and match the derived "Issue X · Volume X" label in JS — simpler and more
    // robust than trying to contains-match a computed string in SQL.
    prisma.articleGroup.findMany({
      where: { status: "PUBLISHED", pdfKey: { not: null } },
      orderBy: { publishedAt: "desc" },
      select: {
        id: true,
        name: true,
        volumeNumber: true,
        issueNumber: true,
        pdfFilename: true,
        publishedAt: true,
      },
    }),
  ]);

  const articleItems: SearchResultItem[] = articles.map(
    (a: (typeof articles)[number]) => {
      const author =
        a.credits.length > 0
          ? { name: a.credits[0]!.user.name ?? "", id: a.credits[0]!.user.id }
          : { name: a.createdBy.name ?? "", id: a.createdBy.id };
      return {
        kind: "article",
        id: a.id,
        title: a.title,
        slug: a.slug,
        excerpt: toExcerpt(a.body),
        section: a.section,
        publishedAt: a.group?.publishedAt?.toISOString() ?? null,
        authorName: author.name,
        authorId: author.id,
      };
    },
  );

  const needle = q.toLowerCase();
  const issueItems: SearchResultItem[] = issueGroups
    .map((g: (typeof issueGroups)[number]) => ({ g, label: issueLabel(g) }))
    .filter(({ g, label }: { g: (typeof issueGroups)[number]; label: string }) => {
      const haystack = [
        label,
        g.name ?? "",
        g.issueNumber != null ? `issue ${g.issueNumber}` : "",
        g.volumeNumber != null ? `volume ${g.volumeNumber} vol ${g.volumeNumber}` : "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    })
    .map(({ g, label }: { g: (typeof issueGroups)[number]; label: string }) => ({
      kind: "issue" as const,
      id: g.id,
      title: label,
      publishedAt: g.publishedAt?.toISOString() ?? null,
    }));

  // Interleave both result types, most-recent first.
  return [...articleItems, ...issueItems].sort((a, b) => {
    const ta = a.publishedAt ? Date.parse(a.publishedAt) : 0;
    const tb = b.publishedAt ? Date.parse(b.publishedAt) : 0;
    return tb - ta;
  });
}
