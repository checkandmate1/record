import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { userMinimalNameSelect } from "@/lib/prisma-selects";
import { auth } from "@/lib/auth";
import { AccountDropdown } from "@/app/account-dropdown";
import { HamburgerButton } from "@/app/sidebar-menu";
import { Footer } from "@/app/footer";
import { PatternRenderer } from "@/app/patterns/pattern-renderer";
import { BlockData } from "@/app/patterns/types";
import { getOrLoad } from "@/lib/page-cache";
import {
  getAuthorInfo,
  getSectionLabel,
  getSectionHref,
  formatDateShort,
  getPreviewText,
} from "@/lib/article-helpers";

const NAV_SECTIONS = [
  { label: "News", href: "/section/news" },
  { label: "Features", href: "/section/features" },
  { label: "Opinions", href: "/section/opinions" },
  { label: "A&E", href: "/section/a-and-e" },
  { label: "MD/Alumni", href: "/section/md-alumni" },
  { label: "Lion\u2019s Den", href: "/section/lions-den" },
];

function formatDateLong(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

interface MoreArticle {
  id: string;
  title: string;
  slug: string;
  body: string;
  excerpt: string | null;
  featuredImage: string | null;
  section: string;
  createdBy: { id: string; name: string; role: string; displayTitle: string | null };
  credits: { creditRole: string; user: { id: string; name: string } }[];
  images: { url: string; caption: string | null; altText: string }[];
  group: { publishedAt: Date | null } | null;
}

type LatestRoundTable = {
  slug: string;
  prompt: string;
  sides: {
    label: string;
    order: number;
    authors: { user: { id: string; name: string } }[];
  }[];
} | null;

interface HomepageData {
  totalPages: number;
  volumeNumber: number | null;
  issueNumber: number | null;
  groupDate: Date;
  mainBlocks: BlockData[];
  sidebarBlocks: BlockData[];
  fullBlocks: BlockData[];
  latestRoundTable: LatestRoundTable;
  moreArticles: MoreArticle[];
  layoutHasRoundTable: boolean;
  hasCurrentGroup: boolean;
  // Current issue's PDF presence + id, surfaced for the date-bar "Read the print
  // issue" link. We expose only the id (not the S3 key) — fetch goes through the
  // streaming proxy at /api/issues/[id]/pdf which auth-checks every request.
  currentGroupId: string | null;
  currentGroupHasPdf: boolean;
}

// All the heavy lifting (DB queries + envelope decryption) for one page of the homepage. Wrapped
// in getOrLoad so concurrent visitors share the result and we don't burn ~30 KMS Decrypt calls
// per render. Invalidated by dashboard mutations via invalidateHomepage().
async function loadHomepageData(currentPage: number): Promise<HomepageData> {
  // Fetch published issues, sorted by vol/issue desc (most recent first).
  const groups = await prisma.articleGroup.findMany({
    where: { status: "PUBLISHED" },
    orderBy: [
      { volumeNumber: { sort: "desc", nulls: "last" } },
      { issueNumber: { sort: "desc", nulls: "last" } },
      { publishedAt: "desc" },
    ],
  });

  const totalPages = groups.length;
  const currentGroup = groups[currentPage - 1] ?? null;
  const volumeNumber = (currentGroup as { volumeNumber?: number | null } | null)?.volumeNumber ?? null;

  let mainBlocks: BlockData[] = [];
  let sidebarBlocks: BlockData[] = [];
  let fullBlocks: BlockData[] = [];
  let groupDate = new Date();
  let groupRoundTable: import("@/app/patterns/types").RoundTableSummary | null = null;

  // latestRoundTable is independent of currentGroup, so fan it out alongside the per-group fetches.
  // moreArticles can't fan out yet because it excludes IDs assigned to the current group's blocks.
  const latestRoundTablePromise = prisma.roundTable.findFirst({
    where: { group: { status: "PUBLISHED" } },
    orderBy: [
      { group: { publishedAt: "desc" } },
      { updatedAt: "desc" },
    ],
    include: {
      sides: {
        orderBy: { order: "asc" },
        include: {
          authors: { include: { user: { select: userMinimalNameSelect } } },
        },
      },
    },
  });

  if (currentGroup) {
    const [fullGroup, currentRoundTable] = await Promise.all([
      prisma.articleGroup.findUnique({
        where: { id: currentGroup.id },
        include: {
          blocks: {
            orderBy: { order: "asc" },
            include: {
              slots: {
                orderBy: { order: "asc" },
                include: {
                  article: {
                    include: {
                      createdBy: { select: userMinimalNameSelect },
                      credits: { include: { user: { select: userMinimalNameSelect } } },
                    },
                  },
                },
              },
            },
          },
        },
      }),
      prisma.roundTable.findUnique({
        where: { groupId: currentGroup.id },
        include: {
          sides: {
            orderBy: { order: "asc" },
            include: { authors: { include: { user: { select: { id: true, name: true, encryptedDek: true, dekKekVersion: true, nameCiphertext: true } } } } },
          },
        },
      }),
    ]);

    groupRoundTable = currentRoundTable
      ? {
          slug: currentRoundTable.slug,
          prompt: currentRoundTable.prompt ?? "",
          sides: currentRoundTable.sides.map((s) => ({
            label: s.label ?? "",
            order: s.order,
            authors: s.authors.map((a) => ({ user: { id: a.user.id, name: a.user.name ?? "" } })),
          })),
        }
      : null;

    const allBlocks = (fullGroup?.blocks ?? []) as unknown as (BlockData & { column: string })[];
    // Articles no longer carry their own publishedAt; expose the group's
    // publishedAt to patterns under the same field name so existing pattern
    // code (which reads `article.publishedAt`) continues to display the date.
    const groupPublishedAt = currentGroup.publishedAt ?? null;
    for (const block of allBlocks) {
      for (const slot of block.slots ?? []) {
        if (slot.article) {
          (slot.article as { publishedAt: Date | null }).publishedAt = groupPublishedAt;
        }
      }
      // Round-table patterns get the group's round table attached.
      if (block.pattern === "round-table" || block.pattern === "sb-round-table" || block.pattern === "round-table-full") {
        block.roundTable = groupRoundTable;
      }
    }
    mainBlocks = allBlocks.filter((b) => b.column === "main");
    sidebarBlocks = allBlocks.filter((b) => b.column === "sidebar");
    fullBlocks = allBlocks.filter((b) => b.column === "full");
    groupDate = currentGroup.publishedAt ?? currentGroup.createdAt;
  }

  const issueNumber = (currentGroup as { issueNumber?: number | null } | null)?.issueNumber ?? null;
  const currentGroupId = currentGroup?.id ?? null;
  const currentGroupHasPdf = !!(currentGroup as { pdfKey?: string | null } | null)?.pdfKey;

  // Collect article IDs already shown on this page so we don't duplicate them in the rails.
  const assignedIds = new Set<string>();
  for (const block of [...mainBlocks, ...sidebarBlocks]) {
    for (const slot of block.slots ?? []) {
      const art = (slot as { article?: { id?: string } | null }).article;
      if (art?.id) assignedIds.add(art.id);
    }
  }

  // Latest round table was kicked off in parallel with the current-group fetch above; await
  // alongside moreArticles so the two final round-trips overlap.
  const [latestRoundTable, moreArticles] = (await Promise.all([
    latestRoundTablePromise,
    prisma.article.findMany({
      where: {
        group: { status: "PUBLISHED" },
        ...(assignedIds.size > 0 ? { id: { notIn: Array.from(assignedIds) } } : {}),
      },
      include: {
        createdBy: { select: userMinimalNameSelect },
        credits: { include: { user: { select: userMinimalNameSelect } } },
        images: { orderBy: { order: "asc" }, take: 1 },
        group: { select: { publishedAt: true } },
      },
      orderBy: [
        { group: { publishedAt: "desc" } },
        { createdAt: "desc" },
      ],
      take: 9,
    }),
  ])) as unknown as [LatestRoundTable, MoreArticle[]];

  // If the editor placed a round-table pattern in the layout, suppress the
  // bottom-of-page teaser so the round table doesn't appear twice.
  const layoutHasRoundTable = [...mainBlocks, ...sidebarBlocks, ...fullBlocks].some(
    (b) => b.pattern === "round-table" || b.pattern === "sb-round-table" || b.pattern === "round-table-full",
  );

  // Strip envelope-encryption byte columns before caching. The lib/prisma extension already
  // populated the plaintext fields on these objects; the Uint8Array columns (encryptedDek,
  // *Ciphertext, *Hash) only exist to feed the decrypt path and are not used by the JSX. Holding
  // them in a long-lived Map causes Next 16's RSC pipeline to throw "Cannot perform Construct on
  // a detached ArrayBuffer" when their underlying buffers get transferred between renders.
  const payload: HomepageData = {
    totalPages,
    volumeNumber,
    issueNumber,
    groupDate,
    mainBlocks,
    sidebarBlocks,
    fullBlocks,
    latestRoundTable,
    moreArticles,
    layoutHasRoundTable,
    hasCurrentGroup: currentGroup != null,
    currentGroupId,
    currentGroupHasPdf,
  };
  stripBytesDeep(payload);
  return payload;
}

// Walk an object/array tree and delete any Uint8Array properties in place. Plain JSON values
// (strings, numbers, Dates, null) pass through unchanged. Cycles aren't expected in Prisma
// results, so no visited set.
function stripBytesDeep(node: unknown): void {
  if (node == null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) stripBytesDeep(item);
    return;
  }
  const obj = node as Record<string, unknown>;
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v instanceof Uint8Array || ArrayBuffer.isView(v)) {
      delete obj[k];
    } else if (typeof v === "object") {
      stripBytesDeep(v);
    }
  }
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const session = await auth();
  const { page: pageParam } = await searchParams;
  const currentPage = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);

  const {
    totalPages,
    volumeNumber,
    issueNumber,
    groupDate,
    mainBlocks,
    sidebarBlocks,
    fullBlocks,
    latestRoundTable,
    moreArticles,
    layoutHasRoundTable,
    hasCurrentGroup,
    currentGroupId,
    currentGroupHasPdf,
  } = await getOrLoad(`homepage:page=${currentPage}`, () => loadHomepageData(currentPage));

  return (
    <div className="min-h-screen flex flex-col bg-white font-body page-enter">
      {/* ============ HEADER ============ */}
      <header className="px-4 sm:px-8 pt-4 pb-2">
        <div className="max-w-[1200px] mx-auto grid grid-cols-[1fr_auto_1fr] items-center">
          <div className="flex items-center gap-4 sm:gap-5 font-headline text-base">
            <HamburgerButton
              isAuthenticated={!!session?.user}
              userRole={session?.user?.role}
            />
          </div>
          <div className="text-center">
            <Link href="/">
              <h1 className="font-masthead text-[44px] sm:text-[60px] lg:text-[72px] leading-none tracking-tight">
                The Record
              </h1>
            </Link>
            <p className="font-body text-[11px] sm:text-[13px] tracking-[0.08em] mt-0.5">
              Horace Mann&rsquo;s Weekly Newspaper Since 1903
            </p>
          </div>
          <div className="flex items-center justify-end gap-4 sm:gap-5 font-headline text-base">
            <Link href="/about" className="hidden sm:inline font-bold tracking-wide">About</Link>
            {session?.user ? (
              <div className="hidden md:block">
                <AccountDropdown
                  userName={session.user.name}
                  userEmail={session.user.email}
                  userImage={session.user.image}
                  userRole={session.user.role ?? "READER"}
                />
              </div>
            ) : (
              <Link
                href="/login"
                className="hidden md:inline font-bold tracking-wide hover:text-maroon transition-colors"
              >
                Sign In
              </Link>
            )}
            <Link href="/search" aria-label="Search" className="p-1">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                <line x1="16.5" y1="16.5" x2="22" y2="22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </Link>
          </div>
        </div>
      </header>

      {/* ============ DATE BAR ============ */}
      <div className="border-t border-rule">
        <p className="text-center font-headline text-[12px] sm:text-[13px] font-semibold tracking-[0.05em] py-1.5">
          {volumeNumber && <>Vol. {volumeNumber}</>}
          {volumeNumber && issueNumber && <> &middot; </>}
          {issueNumber && <>Issue {issueNumber}</>}
          {(volumeNumber || issueNumber) && <> &middot; </>}
          {formatDateLong(groupDate)}
          {currentGroupHasPdf && currentGroupId && (
            <>
              {" "}&middot;{" "}
              <Link
                href={`/api/issues/${currentGroupId}/pdf`}
                target="_blank"
                rel="noopener"
                className="text-maroon hover:underline"
              >
                Read the print issue
              </Link>
            </>
          )}
        </p>
      </div>

      {/* ============ SECTION NAV ============ */}
      <nav className="border-t border-b border-rule overflow-x-auto">
        <div className="max-w-[1200px] mx-auto flex justify-between gap-6 px-4 sm:px-16 py-3 min-w-max sm:min-w-0">
          {NAV_SECTIONS.map((s) => (
            <Link key={s.href} href={s.href} className="font-headline text-lg sm:text-xl tracking-wide whitespace-nowrap hover:text-maroon transition-colors">
              {s.label}
            </Link>
          ))}
        </div>
      </nav>

      {/* ============ MAIN CONTENT ============ */}
      <main className="max-w-[1200px] mx-auto px-4 sm:px-8 pt-8 pb-16">
        {(mainBlocks.length > 0 || sidebarBlocks.length > 0) ? (
          <div className="flex flex-col lg:flex-row">
            {/* Main Column. The sr-only headings keep the document outline
                h1 (masthead) -> h2 (region) -> h3 (pattern headlines); the
                layout patterns start at h3, so without them the page skips. */}
            <section
              aria-labelledby="home-main-heading"
              className="lg:flex-[2] lg:border-r lg:border-neutral-200 lg:pr-8"
            >
              <h2 id="home-main-heading" className="sr-only">
                Top stories
              </h2>
              {mainBlocks.map((block, i) => (
                <div key={block.id}>
                  <PatternRenderer block={block} />
                  {i < mainBlocks.length - 1 && block.dividerStyle !== "none" && (
                    <div className={`my-6 ${block.dividerStyle === "bold" ? "h-[2px] bg-ink" : "h-px bg-neutral-200"}`} />
                  )}
                </div>
              ))}
            </section>
            {/* Sidebar */}
            <section
              aria-labelledby="home-sidebar-heading"
              className="lg:flex-[1] lg:pl-8 mt-8 lg:mt-0 border-t lg:border-t-0 border-neutral-200 pt-8 lg:pt-0"
            >
              <h2 id="home-sidebar-heading" className="sr-only">
                More in this issue
              </h2>
              {sidebarBlocks.map((block, i) => (
                <div key={block.id}>
                  <PatternRenderer block={block} />
                  {i < sidebarBlocks.length - 1 && block.dividerStyle !== "none" && (
                    <div className={`my-6 ${block.dividerStyle === "bold" ? "h-[2px] bg-ink" : "h-px bg-neutral-200"}`} />
                  )}
                </div>
              ))}
            </section>
          </div>
        ) : (
          <div className="text-center py-24">
            <p className="font-headline text-2xl text-neutral-400">
              {hasCurrentGroup ? "This edition has no content yet." : "No editions published yet."}
            </p>
          </div>
        )}

        {/* ---- FULL ROW BLOCKS ---- */}
        {fullBlocks.length > 0 && (
          <section aria-labelledby="home-full-heading" className="mt-12 space-y-8">
            <h2 id="home-full-heading" className="sr-only">
              Featured
            </h2>
            {fullBlocks.map((block, i) => (
              <div key={block.id}>
                <PatternRenderer block={block} />
                {i < fullBlocks.length - 1 && block.dividerStyle !== "none" && (
                  <div className={`mt-8 ${block.dividerStyle === "bold" ? "h-[2px] bg-ink" : "h-px bg-neutral-200"}`} />
                )}
              </div>
            ))}
          </section>
        )}

        {/* ---- ROUND TABLE TEASER ---- */}
        {latestRoundTable && !layoutHasRoundTable && (
          <section className="mt-16">
            <Link
              href="/roundtable"
              className="group block rounded-sm border border-maroon/30 bg-gradient-to-br from-[rgba(139,26,26,0.06)] via-[rgba(139,26,26,0.03)] to-white px-6 py-7 sm:px-10 sm:py-9 hover:border-maroon transition-colors"
            >
              <div className="flex flex-col lg:flex-row lg:items-center gap-6">
                <div className="lg:flex-1 min-w-0">
                  <p className="font-headline text-[11px] sm:text-[12px] font-bold tracking-[0.2em] uppercase text-maroon">
                    The Round Table
                  </p>
                  <h2 className="mt-2 font-headline text-[24px] sm:text-[30px] lg:text-[34px] font-bold leading-tight">
                    {latestRoundTable.prompt || "This week’s discussion"}
                  </h2>
                  <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 font-headline text-[13px]">
                    {latestRoundTable.sides.map((side, i) => {
                      const names = side.authors.map((a) => a.user.name).join(", ");
                      return (
                        <div key={side.order} className="flex items-baseline gap-2">
                          <span className="font-bold tracking-[0.12em] uppercase text-[11px] text-maroon">
                            {side.label?.trim() || `Side ${i + 1}`}
                          </span>
                          <span className="italic text-caption">
                            {names || "(no authors)"}
                          </span>
                          {i === 0 && latestRoundTable.sides.length > 1 && (
                            <span className="hidden sm:inline font-bold tracking-[0.18em] uppercase text-[10px] text-caption/60 mx-1">
                              vs
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="shrink-0 self-start lg:self-center">
                  <span className="inline-flex items-center gap-2 font-headline text-[13px] font-bold tracking-[0.06em] uppercase text-maroon group-hover:underline">
                    Read the discussion
                    <span className="transition-transform group-hover:translate-x-0.5">&rarr;</span>
                  </span>
                </div>
              </div>
            </Link>
          </section>
        )}

        {/* ---- MORE FROM THE RECORD ---- */}
        {moreArticles.length > 0 && (
          <section className="mt-16">
            <div className="flex items-center gap-4">
              <div className="flex-1 h-[2px] bg-rule" />
              <h2 className="font-headline font-bold text-[14px] sm:text-[16px] tracking-[0.18em] uppercase">
                More from The Record
              </h2>
              <div className="flex-1 h-[2px] bg-rule" />
            </div>
            <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-12">
              {moreArticles.map((article) => {
                const author = getAuthorInfo(article);
                const heroImage = article.featuredImage ?? article.images[0]?.url ?? null;
                const heroAlt = article.images[0]?.altText ?? article.title;
                const preview = article.excerpt
                  ? article.excerpt
                  : getPreviewText(article.body, 140);
                return (
                  <article key={article.id} className="flex flex-col">
                    <Link href={`/article/${article.slug}`} className="block group">
                      {heroImage ? (
                        <div className="aspect-[3/2] overflow-hidden bg-neutral-100">
                          <img
                            src={heroImage}
                            alt={heroAlt}
                            className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-500"
                          />
                        </div>
                      ) : (
                        <div className="aspect-[3/2] bg-gradient-to-br from-neutral-100 to-neutral-50 flex items-center justify-center">
                          <span className="font-masthead text-[36px] text-neutral-300">R</span>
                        </div>
                      )}
                    </Link>
                    <div className="mt-3">
                      <Link
                        href={getSectionHref(article.section)}
                        className="inline-block font-headline text-[10px] font-bold tracking-[0.16em] uppercase text-maroon hover:underline"
                      >
                        {getSectionLabel(article.section)}
                      </Link>
                      <h3 className="mt-1.5 font-headline text-[19px] sm:text-[20px] font-bold leading-snug">
                        <Link
                          href={`/article/${article.slug}`}
                          className="hover:text-maroon transition-colors"
                        >
                          {article.title}
                        </Link>
                      </h3>
                      {preview && (
                        <p className="mt-2 font-body text-[14px] leading-[1.55] text-caption">
                          {preview}
                        </p>
                      )}
                      <div className="mt-3 font-headline text-[12px] tracking-wide">
                        <Link
                          href={`/profile/${author.id}`}
                          className="text-maroon hover:underline"
                        >
                          {author.name}
                        </Link>
                        {author.role && (
                          <>
                            {" "}
                            <span className="italic text-caption">{author.role}</span>
                          </>
                        )}
                        {article.group?.publishedAt && (
                          <span className="text-caption/70 ml-2">
                            &middot; {formatDateShort(article.group.publishedAt)}
                          </span>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {/* ---- PAGINATION ---- */}
        {totalPages >= 1 && (
          <div className="mt-12 flex items-center justify-center gap-3 font-headline text-[22px] tracking-wide">
            {currentPage > 1 && (
              <Link
                href={currentPage === 2 ? "/" : `/?page=${currentPage - 1}`}
                className="h-10 px-3 flex items-center border border-ink/20 hover:border-maroon hover:text-maroon transition-colors text-[15px]"
              >
                &larr; Newer
              </Link>
            )}
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
              let pageNum: number;
              if (totalPages <= 7) pageNum = i + 1;
              else if (currentPage <= 4) pageNum = i + 1;
              else if (currentPage >= totalPages - 3) pageNum = totalPages - 6 + i;
              else pageNum = currentPage - 3 + i;
              return (
                <Link
                  key={pageNum}
                  href={pageNum === 1 ? "/" : `/?page=${pageNum}`}
                  className={`w-10 h-10 flex items-center justify-center border transition-colors -indent-[1px] leading-none pb-1 ${
                    pageNum === currentPage
                      ? "border-ink font-bold"
                      : "border-ink/20 hover:border-maroon hover:text-maroon"
                  }`}
                >
                  {pageNum}
                </Link>
              );
            })}
            {currentPage < totalPages && (
              <Link
                href={`/?page=${currentPage + 1}`}
                className="h-10 px-3 flex items-center border border-ink/20 hover:border-maroon hover:text-maroon transition-colors text-[15px]"
              >
                Older &rarr;
              </Link>
            )}
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
