import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { userMinimalNameImageSelect } from "@/lib/prisma-selects";
import { SubpageHeader } from "@/app/subpage-header";
import { Footer } from "@/app/footer";
import {
  getSectionLabel,
  getSectionHref,
  formatDateLong,
  formatDateShort,
  getPreviewText,
} from "@/lib/article-helpers";
import { roleLabel } from "@/lib/roles";

interface ArticleData {
  id: string;
  title: string;
  slug: string;
  body: string;
  excerpt: string | null;
  featuredImage: string | null;
  section: string;
  groupId: string;
  createdBy: { id: string; name: string; role: string; image: string | null; displayTitle: string | null };
  credits: { creditRole: string; user: { id: string; name: string; image: string | null } }[];
  images: { url: string; caption: string | null; altText: string }[];
  group: { issueNumber: number | null; volumeNumber: number | null; publishedAt: Date | null; status: string; pdfKey: string | null } | null;
}

async function loadArticle(slug: string): Promise<ArticleData | null> {
  const article = (await prisma.article.findFirst({
    where: { slug, group: { status: "PUBLISHED" } },
    include: {
      createdBy: { select: userMinimalNameImageSelect },
      credits: { include: { user: { select: userMinimalNameImageSelect } } },
      images: { orderBy: { order: "asc" } },
      group: true,
    },
  })) as unknown as ArticleData | null;
  return article;
}

function resolvePrimaryRole(a: ArticleData): string | null {
  if (a.credits.length > 0) {
    const role = a.credits[0].creditRole;
    return role === "Reader" ? null : role;
  }
  const fallback = a.createdBy.displayTitle ?? roleLabel(a.createdBy.role);
  return fallback === "Reader" ? null : fallback;
}

function splitParagraphs(body: string): string[] {
  return body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const article = await loadArticle(slug);
  if (!article) {
    return { title: "Article not found — The Record" };
  }
  const description = article.excerpt ?? getPreviewText(article.body, 160);
  return {
    title: `${article.title} — The Record`,
    description,
    openGraph: {
      title: article.title,
      description,
      images: article.featuredImage ? [article.featuredImage] : [],
    },
  };
}

export default async function ArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = await loadArticle(slug);
  if (!article) notFound();

  const sectionLabel = getSectionLabel(article.section);
  const sectionHref = getSectionHref(article.section);

  // Author list: all credits if any, otherwise createdBy
  const authors =
    article.credits.length > 0
      ? article.credits.map((c) => ({
          id: c.user.id,
          name: c.user.name,
          image: c.user.image ?? null,
        }))
      : [{
          id: article.createdBy.id,
          name: article.createdBy.name,
          image: article.createdBy.image ?? null,
        }];
  const primaryRole = resolvePrimaryRole(article);

  const heroImage = article.featuredImage ?? article.images[0]?.url ?? null;
  const heroCaption = article.images[0]?.caption ?? null;

  const paragraphs = splitParagraphs(article.body);

  const volumeNumber = article.group?.volumeNumber ?? null;
  const issueNumber = article.group?.issueNumber ?? null;

  const primaryAuthor = authors[0];
  const primaryAuthorRole = primaryRole;

  return (
    <div className="min-h-screen flex flex-col bg-white font-body page-enter">
      <SubpageHeader pageLabel={sectionLabel} badge={sectionLabel} />

      <main className="flex-1 pb-20">
        {/* ============ HEADLINE + META ============ */}
        <div className="max-w-[820px] mx-auto px-4 sm:px-8 pt-10 text-center">
          <h1 className="font-headline font-bold leading-[1.1] text-[34px] sm:text-[44px] lg:text-[54px]">
            {article.title}
          </h1>

          {article.excerpt && (
            <p className="mt-5 font-body italic text-[19px] sm:text-[21px] leading-[1.55] text-caption max-w-[720px] mx-auto">
              {article.excerpt}
            </p>
          )}

          {/* Avatars + byline on one line, centered */}
          <div className="mt-7 flex items-center justify-center gap-3 font-headline text-[15px]">
            <div className="flex -space-x-2 shrink-0">
              {authors.map((a) => (
                <Link
                  key={a.id}
                  href={`/profile/${a.id}`}
                  aria-label={a.name}
                  className="block w-8 h-8 rounded-full ring-2 ring-white overflow-hidden hover:z-10 transition-transform hover:scale-105"
                >
                  {a.image ? (
                    <img
                      src={a.image}
                      alt={a.name}
                      className="w-full h-full object-cover bg-neutral-200"
                    />
                  ) : (
                    <div className="w-full h-full bg-maroon text-white flex items-center justify-center font-headline font-bold text-[13px]">
                      {a.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                </Link>
              ))}
            </div>
            <span>
              By{" "}
              {authors.map((a, i) => (
                <span key={a.id}>
                  <Link
                    href={`/profile/${a.id}`}
                    className="text-maroon font-bold hover:underline"
                  >
                    {a.name}
                  </Link>
                  {i < authors.length - 1 && (
                    <span>{i === authors.length - 2 ? " & " : ", "}</span>
                  )}
                </span>
              ))}
              {primaryRole && (
                <span className="italic text-caption">, {primaryRole}</span>
              )}
            </span>
          </div>

          {article.group?.publishedAt && (
            <p className="mt-1 font-headline text-[13px] tracking-[0.05em] text-caption">
              {formatDateLong(article.group.publishedAt)}
            </p>
          )}

          {article.group?.pdfKey && (
            <div className="mt-6">
              <a
                href={`/api/issues/${article.groupId}/pdf`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 font-headline font-bold text-[13px] tracking-[0.06em] uppercase border-2 border-ink px-5 py-2.5 hover:bg-ink hover:text-white transition-colors"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <path d="M14 2v6h6" />
                </svg>
                View Issue PDF
              </a>
            </div>
          )}

          <div className="mt-8 h-[2px] bg-rule" />
        </div>

        {/* ============ BODY (hero image floats inside, text wraps) ============ */}
        <article className="max-w-[780px] mx-auto px-4 sm:px-8 mt-12 article-body featured-excerpt">
          {heroImage && (
            <figure className="mb-5 sm:float-right sm:ml-8 sm:w-[55%] sm:max-w-[420px]">
              <img
                src={heroImage}
                alt={article.images[0]?.altText ?? article.title}
                className="w-full aspect-[4/3] object-cover bg-neutral-100"
              />
              {heroCaption && (
                <figcaption className="mt-2 text-[12px] tracking-[0.05em] uppercase font-semibold text-caption">
                  {heroCaption}
                </figcaption>
              )}
            </figure>
          )}

          {paragraphs.length === 0 ? (
            <p className="font-body text-[18px] leading-[1.75] text-caption italic">
              This article has no content yet.
            </p>
          ) : (
            paragraphs.map((p, i) => (
              <p
                key={i}
                className="font-body text-[18px] sm:text-[19px] leading-[1.75] mt-[1em] first:mt-0 whitespace-pre-line"
              >
                {p}
              </p>
            ))
          )}

          {/* Inline images after the featured one — stacked full-width */}
          {article.images.slice(1).map((img, i) => (
            <figure key={i} className="clear-both mt-10">
              <img
                src={img.url}
                alt={img.altText}
                className="w-full object-cover bg-neutral-100"
              />
              {img.caption && (
                <figcaption className="mt-2 text-[12px] tracking-[0.05em] uppercase font-semibold text-caption">
                  {img.caption}
                </figcaption>
              )}
            </figure>
          ))}
        </article>

        {/* ============ TAIL ============ */}
        <div className="max-w-[680px] mx-auto px-4 sm:px-8 mt-16">
          <div className="h-px bg-rule" />

          <p className="mt-5 font-headline text-[13px] tracking-[0.08em] uppercase text-caption">
            Published in{" "}
            <Link href={sectionHref} className="text-maroon hover:underline">
              {sectionLabel}
            </Link>
            {(volumeNumber || issueNumber) && (
              <>
                {" "}
                &middot;{" "}
                {volumeNumber && <>Vol. {volumeNumber}</>}
                {volumeNumber && issueNumber && <> &middot; </>}
                {issueNumber && <>No. {issueNumber}</>}
              </>
            )}
          </p>

          {/* Mini author card */}
          <div className="mt-10 flex items-start gap-4 pt-6 border-t border-neutral-200">
            {article.createdBy.image ? (
              <img
                src={article.createdBy.image}
                alt={primaryAuthor.name}
                className="w-14 h-14 rounded-full object-cover bg-neutral-200 shrink-0"
              />
            ) : (
              <div className="w-14 h-14 rounded-full bg-maroon text-white flex items-center justify-center font-headline font-bold text-[20px] shrink-0">
                {primaryAuthor.name.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <Link
                href={`/profile/${primaryAuthor.id}`}
                className="font-headline font-bold text-[17px] text-maroon hover:underline"
              >
                {primaryAuthor.name}
              </Link>
              {primaryAuthorRole && (
                <p className="font-headline italic text-[14px] text-caption mt-0.5">
                  {primaryAuthorRole}
                </p>
              )}
              {article.group?.publishedAt && (
                <p className="font-headline text-[13px] text-caption mt-2">
                  {formatDateShort(article.group.publishedAt)}
                </p>
              )}
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
