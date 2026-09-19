import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { userMinimalNameSelect, userPublicSelect, articleBodySelect, articleListSelect, articleCreditSelect } from "@/lib/prisma-selects";
import { Footer } from "@/app/footer";
import { LayoutEditorWrapper } from "@/app/dashboard/layout-editor-wrapper";
import { formatIssueTitle } from "@/lib/article-helpers";
import { DASHBOARD_ROLES, isDashboardRole } from "@/lib/roles";

const NAV_SECTIONS = [
  { label: "News" },
  { label: "Features" },
  { label: "Opinions" },
  { label: "A&E" },
  { label: "Lion\u2019s Den" },
];

function formatDateLong(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default async function LayoutEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user || !isDashboardRole(session.user.role)) redirect("/dashboard");

  const { id } = await params;

  const [group, staffMembers, roundTable] = await Promise.all([
    prisma.articleGroup.findUnique({
      where: { id },
      include: {
        articles: {
          select: articleBodySelect,
          orderBy: { createdAt: "desc" },
        },
        blocks: {
          orderBy: { order: "asc" },
          include: {
            slots: {
              orderBy: { order: "asc" },
              include: {
                article: {
                  select: {
                    ...articleListSelect,
                    createdBy: { select: userPublicSelect },
                    credits: { select: articleCreditSelect },
                  },
                },
              },
            },
          },
        },
      },
    }),
    prisma.user.findMany({
      where: { role: { in: [...DASHBOARD_ROLES] } },
      select: userMinimalNameSelect,
      orderBy: { name: "asc" },
    }),
    prisma.roundTable.findUnique({
      where: { groupId: id },
      include: {
        sides: {
          orderBy: { order: "asc" },
          include: { authors: { include: { user: { select: userMinimalNameSelect } } } },
        },
      },
    }),
  ]);

  if (!group) notFound();

  const groupRoundTable = roundTable
    ? {
        slug: roundTable.slug,
        prompt: roundTable.prompt ?? "",
        sides: roundTable.sides.map((s) => ({
          label: s.label ?? "",
          order: s.order,
          authors: s.authors.map((a) => ({ user: { id: a.user.id, name: a.user.name ?? "" } })),
        })),
      }
    : null;

  const volumeNumber = (group as any).volumeNumber ?? null;
  const issueNumber = (group as any).issueNumber ?? null;
  const groupDate = group.publishedAt ?? group.createdAt;

  const mainBlocks = group.blocks.filter((b: (typeof group.blocks)[number]) => b.column === "main");
  const sidebarBlocks = group.blocks.filter((b: (typeof group.blocks)[number]) => b.column === "sidebar");
  const fullBlocks = group.blocks.filter((b: (typeof group.blocks)[number]) => b.column === "full");

  const assignedIds = new Set(
    group.blocks.flatMap((b: (typeof group.blocks)[number]) =>
      b.slots.filter((s: (typeof b.slots)[number]) => s.articleId).map((s: (typeof b.slots)[number]) => s.articleId)
    )
  );
  const availableArticles = group.articles.filter(
    (a: (typeof group.articles)[number]) => !assignedIds.has(a.id)
  );

  return (
    <div className="min-h-screen flex flex-col bg-white font-body page-enter">
      {/* ============ HEADER (mirrors homepage, non-interactive) ============ */}
      <header className="px-4 sm:px-8 pt-12 pb-2">
        <div className="max-w-[1200px] mx-auto grid grid-cols-[1fr_auto_1fr] items-center">
          <div className="flex items-center gap-4 sm:gap-5 font-headline text-base">
            <div className="w-6 h-6" />
          </div>
          <div className="text-center">
            <h1 className="font-masthead text-[44px] sm:text-[60px] lg:text-[72px] leading-none tracking-tight">
              The Record
            </h1>
            <p className="font-body text-[11px] sm:text-[13px] tracking-[0.08em] mt-0.5">
              Horace Mann&rsquo;s Weekly Newspaper Since 1903
            </p>
          </div>
          <div className="flex items-center justify-end gap-4 sm:gap-5 font-headline text-base">
            <span className="hidden sm:inline font-bold tracking-wide text-caption/30">About</span>
            <div className="w-8 h-8 rounded-full bg-neutral-200" />
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-caption/30">
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
              <line x1="16.5" y1="16.5" x2="22" y2="22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
        </div>
      </header>

      {/* ============ DATE BAR ============ */}
      <div className="border-t border-rule">
        <p className="text-center font-headline text-[12px] sm:text-[13px] font-semibold tracking-[0.05em] py-1.5">
          {volumeNumber && <>Vol. {volumeNumber}</>}
          {volumeNumber && issueNumber && <> &middot; </>}
          {issueNumber && <>No. {issueNumber}</>}
          {(volumeNumber || issueNumber) && <> &middot; </>}
          {formatDateLong(groupDate)}
        </p>
      </div>

      {/* ============ SECTION NAV ============ */}
      <nav className="border-t border-b border-rule overflow-x-auto">
        <div className="max-w-[1200px] mx-auto flex justify-between gap-6 px-4 sm:px-16 py-3 min-w-max sm:min-w-0">
          {NAV_SECTIONS.map((s) => (
            <span key={s.label} className="font-headline text-lg sm:text-xl tracking-wide whitespace-nowrap text-caption/40 cursor-default">
              {s.label}
            </span>
          ))}
        </div>
      </nav>

      {/* ============ LAYOUT BUILDER ============ */}
      <main className="max-w-[1200px] mx-auto px-4 sm:px-8 pt-8 pb-16 flex-1 w-full">
        <LayoutEditorWrapper
          groupId={id}
          groupName={formatIssueTitle(group as any)}
          mainBlocks={mainBlocks as any}
          sidebarBlocks={sidebarBlocks as any}
          fullBlocks={fullBlocks as any}
          roundTable={groupRoundTable}
          availableArticles={availableArticles as { id: string; title: string; section: string }[]}
          staffMembers={staffMembers as { id: string; name: string }[]}
        />
      </main>

      <Footer />
    </div>
  );
}
