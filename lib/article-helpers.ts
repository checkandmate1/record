import { roleLabel } from "@/lib/roles";

// Accepts null/undefined because encrypted fields (Article.body, RoundTableTurn.body, ...)
// decrypt to null on a KMS/DEK failure — callers must render nothing, not throw a 500.
export function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  return html.replace(/<[^>]*>/g, "").trim();
}

export function formatIssueTitle(group: {
  volumeNumber?: number | null;
  issueNumber?: number | null;
  name?: string | null;
}): string {
  const parts: string[] = [];
  if (group.volumeNumber) parts.push(`Vol. ${group.volumeNumber}`);
  if (group.issueNumber !== null && group.issueNumber !== undefined) {
    parts.push(`Issue ${group.issueNumber}`);
  }
  if (parts.length > 0) return parts.join(" · ");
  return group.name?.trim() || "Untitled Issue";
}

export function getPreviewText(body: string | null | undefined, maxLen = 200): string {
  const plain = stripHtml(body);
  if (plain.length === 0) return "";
  if (plain.length <= maxLen) return plain;
  return plain.slice(0, maxLen).replace(/\s+\S*$/, "") + "...";
}

// Single-letter avatar fallback. Accepts null/undefined for the same reason as stripHtml —
// name is an encrypted field and comes back null on a decrypt failure.
export function getInitials(name: string | null | undefined): string {
  const trimmed = name?.trim();
  if (!trimmed) return "?";
  return trimmed.charAt(0).toUpperCase();
}

export function formatDateShort(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateLong(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function joinAuthorNames(
  credits: { user: { id: string; name: string | null } }[],
): string {
  const names = [...new Map(credits.map((c) => [c.user.id, c.user.name ?? ""])).values()].filter(Boolean);
  if (names.length === 0) return "";
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

// Returns every credited author, deduped by id, plus the primary role
// (from credits[0]). Falls back to createdBy only when there are no credits.
export function getBylineAuthors(article: {
  credits: { creditRole: string | null; user: { id: string; name: string | null } }[];
  createdBy: { id: string; name: string | null; role: string; displayTitle: string | null };
}): { authors: { id: string; name: string }[]; primaryRole: string | null } {
  if (article.credits.length > 0) {
    const seen = new Set<string>();
    const authors: { id: string; name: string }[] = [];
    for (const c of article.credits) {
      if (seen.has(c.user.id)) continue;
      seen.add(c.user.id);
      authors.push({ id: c.user.id, name: c.user.name ?? "" });
    }
    const role = article.credits[0]!.creditRole ?? "";
    return { authors, primaryRole: role === "Reader" || role === "" ? null : role };
  }
  const fallback = article.createdBy.displayTitle ?? roleLabel(article.createdBy.role);
  return {
    authors: [{ id: article.createdBy.id, name: article.createdBy.name ?? "" }],
    primaryRole: fallback === "Reader" ? null : fallback,
  };
}

const SECTION_LABELS: Record<string, string> = {
  NEWS: "News", FEATURES: "Features", OPINIONS: "Opinions",
  A_AND_E: "A&E", LIONS_DEN: "Lion\u2019s Den", THE_ROUNDTABLE: "The Roundtable",
  MD_ALUMNI: "MD/Alumni",
};

const SECTION_HREFS: Record<string, string> = {
  NEWS: "/section/news", FEATURES: "/section/features", OPINIONS: "/section/opinions",
  A_AND_E: "/section/a-and-e", LIONS_DEN: "/section/lions-den", THE_ROUNDTABLE: "/section/the-roundtable",
  MD_ALUMNI: "/section/md-alumni",
};

export function getSectionLabel(section: string): string {
  return SECTION_LABELS[section] ?? section;
}

export function getSectionHref(section: string): string {
  return SECTION_HREFS[section] ?? "#";
}

export function getAuthorInfo(article: {
  credits: { creditRole: string; user: { id: string; name: string } }[];
  createdBy: { id: string; name: string; role: string; displayTitle: string | null };
}): { name: string; role: string | null; id: string } {
  if (article.credits.length > 0) {
    const primary = article.credits[0];
    return { name: primary.user.name, role: hideReader(primary.creditRole), id: primary.user.id };
  }
  return {
    name: article.createdBy.name,
    role: hideReader(article.createdBy.displayTitle ?? roleLabel(article.createdBy.role)),
    id: article.createdBy.id,
  };
}

function hideReader(role: string): string | null {
  return role === "Reader" ? null : role;
}
