import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { userMinimalNameSelect } from "@/lib/prisma-selects";
import { Section } from "@prisma/client";
import { SubpageHeader } from "@/app/subpage-header";
import { Footer } from "@/app/footer";
import { roleLabel } from "@/lib/roles";

const SLUG_TO_SECTION: Record<string, { label: string; fullLabel?: string; dbKey: string }> = {
  news: { label: "News", dbKey: "NEWS" },
  features: { label: "Features", dbKey: "FEATURES" },
  opinions: { label: "Opinions", dbKey: "OPINIONS" },
  "a-and-e": { label: "A&E", fullLabel: "Arts & Entertainment", dbKey: "A_AND_E" },
  "lions-den": { label: "Lion\u2019s Den", dbKey: "LIONS_DEN" },
  "the-roundtable": { label: "The Roundtable", dbKey: "THE_ROUNDTABLE" },
  "md-alumni": { label: "MD/Alumni", dbKey: "MD_ALUMNI" },
};

interface ArticleData {
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

function formatDateLong(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatDateShort(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim();
}

function getExcerptText(article: ArticleData): string {
  if (article.excerpt) return article.excerpt;
  const plain = stripHtml(article.body);
  if (plain.length <= 280) return plain;
  return plain.slice(0, 280).replace(/\s+\S*$/, "") + "\u2026";
}

function getAuthorInfo(article: ArticleData): { name: string; role: string | null; id: string } {
  if (article.credits.length > 0) {
    const primary = article.credits[0];
    return {
      name: primary.user.name,
      role: hideReader(primary.creditRole),
      id: primary.user.id,
    };
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

const PER_PAGE = 10;

export default async function SectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { slug } = await params;
  const { page: pageParam } = await searchParams;
  const currentPage = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);
  const sectionInfo = SLUG_TO_SECTION[slug];

  if (!sectionInfo) {
    notFound();
  }

  const sectionWhere = {
    group: { status: "PUBLISHED" as const },
    section: sectionInfo.dbKey as Section,
  };

  const [articles, totalCount] = await Promise.all([
    prisma.article.findMany({
      where: sectionWhere,
      orderBy: { group: { publishedAt: "desc" } },
      skip: (currentPage - 1) * PER_PAGE,
      take: PER_PAGE,
      include: {
        createdBy: { select: userMinimalNameSelect },
        credits: { include: { user: { select: userMinimalNameSelect } } },
        images: { orderBy: { order: "asc" } },
        group: { select: { publishedAt: true } },
    },
    }) as Promise<unknown>,
    prisma.article.count({ where: sectionWhere }),
  ]);

  const allArticles = articles as unknown as ArticleData[];
  const totalPages = Math.ceil(totalCount / PER_PAGE);

  const featured = allArticles[0] ?? null;
  const rest = allArticles.slice(1);
  const today = new Date();

  return (
    <div className="min-h-screen flex flex-col bg-white font-body page-enter">
      <SubpageHeader pageLabel={sectionInfo.label} badge={sectionInfo.label} />

      {/* ============ SECTION TITLE ============ */}
      <div className="max-w-[1200px] mx-auto px-4 sm:px-8 pt-8">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="font-headline text-[32px] sm:text-[40px] font-bold leading-tight tracking-wide">
              {sectionInfo.fullLabel ?? sectionInfo.label}
            </h2>
            <p className="font-headline text-[12px] sm:text-[13px] font-semibold tracking-[0.05em] text-caption mt-1">
              {formatDateLong(today)}
            </p>
          </div>
          {slug === "opinions" && (
            <Link
              href="/roundtable"
              className="group shrink-0 hidden sm:flex items-center gap-2 font-headline text-[13px] font-bold tracking-[0.08em] uppercase text-maroon border border-maroon/30 px-4 py-2 hover:bg-maroon hover:text-white transition-colors"
            >
              The Round Table
              <span className="transition-transform group-hover:translate-x-0.5">&rarr;</span>
            </Link>
          )}
        </div>
        {slug === "opinions" && (
          <Link
            href="/roundtable"
            className="sm:hidden mt-3 inline-flex items-center gap-2 font-headline text-[12px] font-bold tracking-[0.08em] uppercase text-maroon"
          >
            The Round Table &rarr;
          </Link>
        )}
        <div className="mt-4 h-[2px] bg-rule" />
      </div>

      {/* ============ MAIN CONTENT ============ */}
      <main className="max-w-[1200px] mx-auto px-4 sm:px-8 pt-8 pb-16">
        {featured ? (
          <>
            {/* ---------- FEATURED ARTICLE ---------- */}
            <div className="flex flex-col lg:flex-row">
              <article className="lg:flex-[3] lg:pr-10 pb-8 lg:pb-0">
                {/* Headline */}
                <h3 className="font-headline text-[26px] sm:text-[30px] lg:text-[34px] font-bold leading-tight mb-5">
                  <Link
                    href={`/article/${featured.slug}`}
                    className="hover:text-maroon transition-colors"
                  >
                    {featured.title}
                  </Link>
                </h3>

                {/* Excerpt with floated image */}
                <div className="featured-excerpt text-[17px] leading-[1.7]">
                  {featured.featuredImage && (
                    <figure className="sm:float-right sm:ml-6 mb-5 sm:w-[55%] sm:max-w-[420px]">
                      <img
                        src={featured.featuredImage}
                        alt={featured.images[0]?.altText ?? featured.title}
                        className="w-full aspect-[4/3] object-cover bg-neutral-100"
                      />
                      {featured.images[0]?.caption && (
                        <figcaption className="mt-1.5 text-[11px] tracking-[0.06em] flex justify-between text-caption">
                          <span className="uppercase font-semibold">
                            {featured.images[0].caption}
                          </span>
                          {featured.images[0].altText && (
                            <span>{featured.images[0].altText}</span>
                          )}
                        </figcaption>
                      )}
                    </figure>
                  )}
                  <p>{getExcerptText(featured)}</p>
                </div>

                {/* Author + Date */}
                <div className="mt-6 clear-both">
                  <p className="font-headline text-[15px]">
                    <Link
                      href={`/profile/${getAuthorInfo(featured).id}`}
                      className="text-maroon font-bold hover:underline"
                    >
                      {getAuthorInfo(featured).name}
                    </Link>
                    {getAuthorInfo(featured).role && (
                      <>
                        {" "}
                        <span className="italic">
                          {getAuthorInfo(featured).role}
                        </span>
                      </>
                    )}
                  </p>
                  {featured.group?.publishedAt && (
                    <p className="text-maroon text-[15px] font-headline font-semibold mt-0.5">
                      {formatDateShort(featured.group.publishedAt)}
                    </p>
                  )}
                </div>
              </article>

              {/* Vertical Divider + First sidebar articles */}
              {rest.length > 0 && (
                <>
                  <div className="hidden lg:block w-px bg-rule shrink-0" />
                  <aside className="lg:flex-[2] lg:pl-8 border-t border-neutral-300 lg:border-t-0 pt-6 lg:pt-0">
                    <div className="divide-y divide-neutral-300">
                      {rest.slice(0, 4).map((article) => {
                        const author = getAuthorInfo(article);
                        return (
                          <div key={article.id} className="py-4 first:pt-0">
                            <div className={article.featuredImage ? "flex gap-4" : ""}>
                              {article.featuredImage && (
                                <Link href={`/article/${article.slug}`} className="shrink-0">
                                  <img
                                    src={article.featuredImage}
                                    alt={article.title}
                                    className="w-[90px] max-h-[80px] object-contain"
                                  />
                                </Link>
                              )}
                              <div className="min-w-0">
                                <h3 className="font-headline text-[17px] font-bold leading-snug">
                                  <Link
                                    href={`/article/${article.slug}`}
                                    className="hover:text-maroon transition-colors"
                                  >
                                    {article.title}
                                  </Link>
                                </h3>
                                <div className="mt-2 flex items-baseline justify-between gap-3 font-headline text-[14px]">
                                  <span>
                                    <Link
                                      href={`/profile/${author.id}`}
                                      className="text-maroon hover:underline"
                                    >
                                      {author.name}
                                    </Link>
                                    {author.role && (
                                      <>
                                        {" "}
                                        <span className="italic">{author.role}</span>
                                      </>
                                    )}
                                  </span>
                                  {article.group?.publishedAt && (
                                    <span className="text-caption text-[13px] shrink-0">
                                      {formatDateShort(article.group.publishedAt)}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </aside>
                </>
              )}
            </div>

            {/* ---------- REMAINING ARTICLES ---------- */}
            {rest.length > 4 && (
              <>
                <div className="mt-10 h-px bg-rule" />
                <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-8">
                  {rest.slice(4).map((article) => {
                    const author = getAuthorInfo(article);
                    return (
                      <article key={article.id} className="border-t border-neutral-300 pt-5">
                        {article.featuredImage && (
                          <Link href={`/article/${article.slug}`}>
                            <img
                              src={article.featuredImage}
                              alt={article.images[0]?.altText ?? article.title}
                              className="w-full aspect-[3/2] object-cover bg-neutral-100 mb-4"
                            />
                          </Link>
                        )}
                        <h3 className="font-headline text-[18px] font-bold leading-snug">
                          <Link
                            href={`/article/${article.slug}`}
                            className="hover:text-maroon transition-colors"
                          >
                            {article.title}
                          </Link>
                        </h3>
                        <p className="mt-2 text-[15px] leading-[1.6] text-caption">
                          {getExcerptText(article)}
                        </p>
                        <div className="mt-3 font-headline text-[14px]">
                          <Link
                            href={`/profile/${author.id}`}
                            className="text-maroon hover:underline"
                          >
                            {author.name}
                          </Link>
                          {author.role && (
                            <>
                              {" "}
                              <span className="italic">{author.role}</span>
                            </>
                          )}
                          {article.group?.publishedAt && (
                            <span className="text-caption ml-2">
                              &middot; {formatDateShort(article.group.publishedAt)}
                            </span>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </>
            )}
          </>
        ) : (
          /* Empty state */
          <div className="text-center py-24">
            <p className="font-headline text-2xl text-neutral-400">
              No articles published in {sectionInfo.fullLabel ?? sectionInfo.label} yet.
            </p>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mt-12 flex items-center justify-center gap-2 font-headline text-[15px] tracking-wide">
            {currentPage > 1 && (
              <Link
                href={currentPage === 2 ? `/section/${slug}` : `/section/${slug}?page=${currentPage - 1}`}
                className="px-4 py-2 border border-ink/20 hover:border-maroon hover:text-maroon transition-colors"
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
                  href={pageNum === 1 ? `/section/${slug}` : `/section/${slug}?page=${pageNum}`}
                  className={`w-10 h-10 flex items-center justify-center transition-colors ${
                    pageNum === currentPage
                      ? "bg-ink text-white"
                      : "border border-ink/10 hover:border-maroon hover:text-maroon"
                  }`}
                >
                  {pageNum}
                </Link>
              );
            })}
            {currentPage < totalPages && (
              <Link
                href={`/section/${slug}?page=${currentPage + 1}`}
                className="px-4 py-2 border border-ink/20 hover:border-maroon hover:text-maroon transition-colors"
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
