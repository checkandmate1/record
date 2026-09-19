import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { userMinimalNameSelect } from "@/lib/prisma-selects";
import { SubpageHeader } from "@/app/subpage-header";
import { Footer } from "@/app/footer";
import {
  getSectionLabel,
  getSectionHref,
  formatDateShort,
  getPreviewText,
} from "@/lib/article-helpers";
import { roleLabel as roleDisplayName } from "@/lib/roles";

interface UserData {
  id: string;
  name: string;
  image: string | null;
  role: string;
  displayTitle: string | null;
  createdAt: Date;
}

interface ArticleListItem {
  id: string;
  title: string;
  slug: string;
  body: string;
  excerpt: string | null;
  featuredImage: string | null;
  section: string;
  credits: { creditRole: string; user: { id: string; name: string } }[];
  images: { url: string; altText: string }[];
  group: { publishedAt: Date | null } | null;
}

const PER_PAGE = 10;

// Wrapped in React.cache() so generateMetadata and the page component share one query per
// request instead of each independently hitting the DB (and re-paying the KMS decrypt cost).
const loadUser = cache(async (id: string): Promise<UserData | null> => {
  const user = (await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      image: true,
      role: true,
      displayTitle: true,
      createdAt: true,
      // envelope encryption metadata — needed by lib/prisma extension to decrypt name/image.
      encryptedDek: true,
      dekKekVersion: true,
      nameCiphertext: true,
      imageCiphertext: true,
    },
  })) as unknown as UserData | null;
  return user;
});

function roleLabel(user: UserData): string | null {
  const label = user.displayTitle ?? roleDisplayName(user.role);
  return label === "Reader" ? null : label;
}

function joinMonth(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function roleOnArticle(article: ArticleListItem, userId: string): string | null {
  const credit = article.credits.find((c) => c.user.id === userId);
  if (!credit) return null;
  return credit.creditRole === "Reader" ? null : credit.creditRole;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const user = await loadUser(id);
  if (!user) return { title: "Profile not found — The Record" };
  const rl = roleLabel(user);
  return {
    title: `${user.name} — The Record`,
    description: rl
      ? `Articles by ${user.name}, ${rl}, for The Record.`
      : `Articles by ${user.name} for The Record.`,
    openGraph: {
      title: user.name,
      images: user.image ? [user.image] : [],
    },
  };
}

export default async function ProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { id } = await params;
  const { page: pageParam } = await searchParams;
  const currentPage = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);

  const user = await loadUser(id);
  if (!user) notFound();

  const whereArticles = {
    group: { status: "PUBLISHED" as const },
    credits: { some: { userId: id } },
  };

  const [articlesRaw, totalCount, firstArticle] = await Promise.all([
    prisma.article.findMany({
      where: whereArticles,
      orderBy: { group: { publishedAt: "desc" } },
      skip: (currentPage - 1) * PER_PAGE,
      take: PER_PAGE,
      include: {
        credits: { include: { user: { select: userMinimalNameSelect } } },
        images: { orderBy: { order: "asc" }, take: 1 },
        group: { select: { publishedAt: true } },
      },
    }) as Promise<unknown>,
    prisma.article.count({ where: whereArticles }),
    prisma.article.findFirst({
      where: whereArticles,
      orderBy: { group: { publishedAt: "asc" } },
      select: { group: { select: { publishedAt: true } } },
    }),
  ]);

  const articles = articlesRaw as unknown as ArticleListItem[];
  const totalPages = Math.ceil(totalCount / PER_PAGE);

  const rl = roleLabel(user);
  const firstInitial = (user.name ?? "?").charAt(0).toUpperCase();
  const basePath = `/profile/${id}`;

  return (
    <div className="min-h-screen flex flex-col bg-white font-body page-enter">
      <SubpageHeader pageLabel="Profile" badge="Profile" />

      <main className="flex-1 max-w-[1100px] w-full mx-auto px-4 sm:px-8 pt-10 pb-20">
        {/* ============ IDENTITY ============ */}
        <section className="flex items-center gap-6 sm:gap-8">
          {user.image ? (
            <img
              src={user.image}
              alt={user.name}
              className="w-20 h-20 sm:w-24 sm:h-24 rounded-full object-cover bg-neutral-200 shrink-0"
            />
          ) : (
            <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-maroon text-white flex items-center justify-center font-headline font-bold text-[32px] sm:text-[36px] shrink-0">
              {firstInitial}
            </div>
          )}
          <div className="min-w-0">
            <h1 className="font-headline font-bold text-[28px] sm:text-[36px] leading-tight">
              {user.name}
            </h1>
            {rl && (
              <p className="font-headline italic text-[15px] sm:text-[16px] text-caption mt-1">
                {rl}
              </p>
            )}
            <p className="font-headline text-[12px] sm:text-[13px] tracking-[0.08em] uppercase text-caption mt-2">
              Joined {joinMonth(user.createdAt)}
            </p>
          </div>
        </section>

        <div className="mt-8 h-[2px] bg-rule" />

        {/* ============ STATS ============ */}
        {totalCount > 0 && (
          <p className="mt-6 font-headline text-[14px] tracking-[0.05em] text-caption">
            {totalCount} {totalCount === 1 ? "article" : "articles"}
            {firstArticle?.group?.publishedAt && (
              <>
                {" "}
                &middot; First published {formatDateShort(firstArticle.group.publishedAt)}
              </>
            )}
          </p>
        )}

        {/* ============ CONTRIBUTIONS ============ */}
        <section className="mt-10">
          <h2 className="font-headline font-bold tracking-wide text-[22px] sm:text-[24px]">
            Contributions
          </h2>

          {articles.length === 0 ? (
            <div className="text-center py-20">
              <p className="font-headline text-2xl text-neutral-400">
                No published articles yet.
              </p>
            </div>
          ) : (
            <ul className="mt-6 divide-y divide-neutral-300">
              {articles.map((article) => {
                const role = roleOnArticle(article, id);
                const thumb = article.featuredImage ?? article.images[0]?.url ?? null;
                const excerpt = article.excerpt ?? getPreviewText(article.body, 180);
                return (
                  <li key={article.id} className="py-5 first:pt-0">
                    <div className="flex gap-5">
                      {thumb && (
                        <Link
                          href={`/article/${article.slug}`}
                          className="shrink-0 hidden sm:block"
                        >
                          <img
                            src={thumb}
                            alt={article.title}
                            className="w-[160px] aspect-[3/2] object-cover bg-neutral-100"
                          />
                        </Link>
                      )}
                      <div className="min-w-0 flex-1">
                        <Link
                          href={getSectionHref(article.section)}
                          className="font-headline text-[12px] font-semibold tracking-[0.12em] uppercase text-maroon hover:underline"
                        >
                          {getSectionLabel(article.section)}
                        </Link>
                        <h3 className="mt-1 font-headline font-bold text-[19px] sm:text-[20px] leading-snug">
                          <Link
                            href={`/article/${article.slug}`}
                            className="hover:text-maroon transition-colors"
                          >
                            {article.title}
                          </Link>
                        </h3>
                        <p className="mt-2 text-[15px] leading-[1.6] text-caption">
                          {excerpt}
                        </p>
                        <div className="mt-2 font-headline text-[13px] text-caption flex flex-wrap gap-x-2">
                          {role && <span className="italic">{role}</span>}
                          {role && article.group?.publishedAt && <span>&middot;</span>}
                          {article.group?.publishedAt && (
                            <span>{formatDateShort(article.group.publishedAt)}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* ============ PAGINATION ============ */}
        {totalPages > 1 && (
          <div className="mt-12 flex items-center justify-center gap-2 font-headline text-[15px] tracking-wide">
            {currentPage > 1 && (
              <Link
                href={currentPage === 2 ? basePath : `${basePath}?page=${currentPage - 1}`}
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
                  href={pageNum === 1 ? basePath : `${basePath}?page=${pageNum}`}
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
                href={`${basePath}?page=${currentPage + 1}`}
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
