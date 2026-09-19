import Link from "next/link";
import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  userMinimalNameImageSelect,
  articleCreditSelect,
  roundTableSummarySelect,
} from "@/lib/prisma-selects";
import { SubpageHeader } from "@/app/subpage-header";
import {
  updateGroup,
  publishGroup,
  unpublishGroup,
  scheduleGroup,
  deleteGroup,
} from "@/app/dashboard/group-actions";
import { SavedToast } from "@/app/dashboard/saved-toast";
import { ApprovalDisplay } from "@/app/dashboard/approval-display";
import { IssuePdfSection } from "@/app/dashboard/issue-pdf-section";
import { ScheduleForm } from "@/app/dashboard/schedule-form";
import { joinAuthorNames, formatIssueTitle } from "@/lib/article-helpers";
import { getSiteVolumeAndIssue } from "@/lib/site-volume";
import { isDashboardRole, isEditorRole } from "@/lib/roles";

const SECTION_LABELS: Record<string, string> = {
  NEWS: "News", FEATURES: "Features", OPINIONS: "Opinions",
  A_AND_E: "A&E", LIONS_DEN: "Lion\u2019s Den", THE_ROUNDTABLE: "The Roundtable",
  MD_ALUMNI: "MD/Alumni",
};

export default async function GroupEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const session = await auth();
  if (!session?.user || !isDashboardRole(session.user.role)) redirect("/dashboard");

  const { id } = await params;
  const { saved } = await searchParams;

  const { volumeNumber: siteVolume } = await getSiteVolumeAndIssue();
  const sitePlaceholder = siteVolume != null ? String(siteVolume) : "";

  const group = await prisma.articleGroup.findUnique({
    where: { id },
    include: {
      articles: {
        select: {
          id: true,
          title: true,
          section: true,
          credits: {
            select: articleCreditSelect,
          },
        },
        orderBy: { createdAt: "desc" },
      },
      roundTables: {
        select: roundTableSummarySelect,
      },
      blocks: {
        orderBy: { order: "asc" },
        include: {
          slots: {
            orderBy: { order: "asc" },
            include: {
              article: { select: { id: true, title: true, section: true } },
            },
          },
        },
      },
      approvals: {
        include: { user: { select: userMinimalNameImageSelect } },
        orderBy: { createdAt: "asc" as const },
      },
    },
  });

  if (!group) notFound();

  const approvers = (group.approvals ?? []).map((a: any) => ({
    id: a.user.id,
    approvalId: a.id,
    name: a.user.name,
    image: a.user.image,
  }));
  const hasApproved = approvers.some((a: any) => a.id === session.user.id);
  const canManage = isEditorRole(session.user.role);
  const canPublish = isEditorRole(session.user.role);

  // Split blocks by column
  const mainBlocks = group.blocks.filter((b: any) => b.column === "main");
  const sidebarBlocks = group.blocks.filter((b: any) => b.column === "sidebar");

  const totalSlots = group.blocks.reduce((sum: number, b: any) => sum + b.slots.length, 0);

  const boundUpdate = updateGroup.bind(null, id);
  const boundPublish = publishGroup.bind(null, id);
  const boundUnpublish = unpublishGroup.bind(null, id);
  const boundSchedule = scheduleGroup.bind(null, id);
  const boundDelete = deleteGroup.bind(null, id);

  return (
    <div className="min-h-screen flex flex-col bg-white font-body page-enter">
      <SubpageHeader pageLabel="Edit Issue" />
      {saved && <SavedToast />}

      <div className="max-w-[900px] mx-auto px-4 sm:px-8 pt-8 pb-16">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-headline text-[28px] sm:text-[34px] font-bold tracking-wide leading-tight">
              {formatIssueTitle(group)}
            </h2>
            <p className="font-headline text-[13px] text-caption mt-1">
              {group.blocks.length} blocks &middot; {totalSlots} slots
              &middot; {group.articles.length} articles
            </p>
          </div>
          <span
            className={`shrink-0 font-headline text-[12px] font-semibold tracking-[0.08em] uppercase px-3 py-1.5 ${
              group.status === "PUBLISHED"
                ? "bg-green-50 text-green-800"
                : "bg-amber-50 text-amber-800"
            }`}
          >
            {group.status}
          </span>
        </div>

        {/* Approval */}
        <div className="mt-4">
          <ApprovalDisplay
            approvers={approvers}
            currentUserId={session.user.id}
            hasApproved={hasApproved}
            onApprove={async () => { "use server"; const { approveGroup } = await import("@/app/dashboard/group-actions"); await approveGroup(id); }}
            onRemoveApproval={async (approvalId: string) => { "use server"; const { removeGroupApproval } = await import("@/app/dashboard/group-actions"); await removeGroupApproval(approvalId, id); }}
            canRemoveOthers={canManage}
          />
        </div>

        {/* Volume (locked) + Issue # (EDITOR+ only) */}
        {canManage && (
          <form action={boundUpdate} className="mt-4 flex gap-3 items-end">
            <div>
              <label htmlFor="group-volume" className="block font-headline text-[11px] font-semibold tracking-[0.08em] uppercase text-caption mb-1">
                Volume #
              </label>
              <input
                id="group-volume"
                name="volumeNumber"
                type="number"
                min="1"
                step="1"
                defaultValue={(group as any).volumeNumber ?? ""}
                placeholder={sitePlaceholder || "—"}
                className="w-24 border border-ink/20 px-3 py-2 font-headline text-[16px] tracking-wide outline-none focus:border-ink transition-colors text-center"
              />
            </div>
            <div>
              <label htmlFor="group-issue" className="block font-headline text-[11px] font-semibold tracking-[0.08em] uppercase text-caption mb-1">
                Issue #
              </label>
              <input
                id="group-issue"
                name="issueNumber"
                type="number"
                min="1"
                step="1"
                defaultValue={(group as any).issueNumber ?? ""}
                placeholder="#"
                className="w-24 border border-ink/20 px-3 py-2 font-headline text-[16px] tracking-wide outline-none focus:border-ink transition-colors text-center"
              />
            </div>
            <button type="submit" className="cursor-pointer font-headline font-bold text-[13px] tracking-wide bg-ink text-white px-5 py-2 hover:bg-maroon transition-colors">
              Save
            </button>
          </form>
        )}

        {/* Actions */}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {canPublish && group.status === "DRAFT" && (
            (group as any).volumeNumber != null && (group as any).issueNumber != null ? (
              <form action={boundPublish}>
                <button type="submit" className="cursor-pointer font-headline font-bold text-[14px] tracking-wide bg-green-800 text-white px-5 py-2 hover:bg-green-900 transition-colors">
                  Publish Now
                </button>
              </form>
            ) : (
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled
                  title="Set a volume number and issue number before publishing"
                  className="font-headline font-bold text-[14px] tracking-wide bg-green-800/40 text-white px-5 py-2 cursor-not-allowed"
                >
                  Publish Now
                </button>
                <span className="font-headline text-[12px] text-maroon">
                  Set a volume &amp; issue number above to publish.
                </span>
              </div>
            )
          )}
          {canPublish && group.status === "PUBLISHED" && (
            <form action={boundUnpublish}>
              <button type="submit" className="cursor-pointer font-headline font-bold text-[14px] tracking-wide border border-ink/20 px-5 py-2 text-caption hover:border-maroon hover:text-maroon transition-colors">
                Unpublish
              </button>
            </form>
          )}
          {canPublish && group.status === "DRAFT" && (
            {/* The label/id pair from #56 lives inside ScheduleForm along with the input. */}
            <ScheduleForm
              scheduledAtIso={group.scheduledAt?.toISOString() ?? null}
              action={boundSchedule}
            />
          )}
          {canManage && (
            <form action={boundDelete} className="ml-auto">
              <button type="submit" className="cursor-pointer font-headline text-[13px] tracking-wide text-caption/50 hover:text-maroon transition-colors">
                Delete Issue
              </button>
            </form>
          )}
        </div>
        <div className="mt-4 h-[2px] bg-rule" />

        {/* Articles */}
        <div className="mt-8">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-headline text-[20px] font-bold tracking-wide">Articles</h3>
            <Link
              href={`/dashboard/groups/${id}/articles/new`}
              className="font-headline font-bold text-[13px] tracking-wide bg-ink text-white px-4 py-2 hover:bg-maroon transition-colors"
            >
              Create Article
            </Link>
          </div>

          {group.articles.length > 0 ? (
            <div className="space-y-1.5">
              {group.articles.map((a: (typeof group.articles)[number]) => {
                const byline = joinAuthorNames(a.credits);
                return (
                  <div key={a.id} className="flex items-center justify-between gap-2 border border-ink/10 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2 min-w-0">
                        <Link
                          href={`/dashboard/articles/${a.id}/edit`}
                          className="font-headline text-[14px] font-semibold truncate hover:text-maroon transition-colors"
                        >
                          {a.title}
                        </Link>
                        <span className="font-headline text-[11px] text-caption/50 shrink-0">
                          {SECTION_LABELS[a.section] ?? a.section}
                        </span>
                      </div>
                      <p className="font-headline text-[12px] text-caption mt-0.5 truncate">
                        {byline ? <>By {byline}</> : <span className="italic text-caption/50">Uncredited</span>}
                      </p>
                    </div>
                    <Link
                      href={`/dashboard/articles/${a.id}/edit`}
                      className="font-headline text-[12px] text-maroon hover:underline shrink-0"
                    >
                      Edit
                    </Link>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="font-headline text-[14px] text-caption/50 italic">
              No articles yet. Create one above.
            </p>
          )}
        </div>
        <div className="mt-6 h-[2px] bg-rule" />

        {/* Round Table (one per group) */}
        <div className="mt-8">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-headline text-[20px] font-bold tracking-wide">Round Table</h3>
            {group.roundTables.length === 0 && (
              <form
                action={async () => {
                  "use server";
                  const { createRoundTable } = await import("@/app/dashboard/roundtable-actions");
                  await createRoundTable(id);
                }}
              >
                <button
                  type="submit"
                  className="cursor-pointer font-headline font-bold text-[13px] tracking-wide bg-ink text-white px-4 py-2 hover:bg-maroon transition-colors"
                >
                  Create Round Table
                </button>
              </form>
            )}
          </div>

          {group.roundTables.length > 0 ? (
            (() => {
              const rt = group.roundTables[0];
              const sideSummary = rt.sides
                .map((s) => {
                  const names = s.authors.map((a) => a.user.name).join(", ") || "(no authors)";
                  return `${s.label}: ${names}`;
                })
                .join("  vs  ");
              return (
                <div className="flex items-center justify-between gap-2 border border-ink/10 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/dashboard/roundtables/${rt.id}/edit`}
                      className="font-headline text-[14px] font-semibold truncate hover:text-maroon transition-colors block"
                    >
                      {rt.prompt}
                    </Link>
                    <p className="font-headline text-[12px] text-caption mt-0.5 truncate">
                      {sideSummary} &middot; {rt.turns.length} turns
                    </p>
                  </div>
                  <Link
                    href={`/dashboard/roundtables/${rt.id}/edit`}
                    className="font-headline text-[12px] text-maroon hover:underline shrink-0"
                  >
                    Edit
                  </Link>
                </div>
              );
            })()
          ) : (
            <p className="font-headline text-[14px] text-caption/50 italic">
              No round table for this group yet.
            </p>
          )}
        </div>
        <div className="mt-6 h-[2px] bg-rule" />

        {/* PDF */}
        <div className="mt-8">
          <IssuePdfSection
            groupId={id}
            hasPdf={!!group.pdfKey}
            pdfFilename={group.pdfFilename ?? null}
            pdfByteSize={group.pdfByteSize ?? null}
            pdfUploadedAt={group.pdfUploadedAt ?? null}
            canManage={canManage}
          />
        </div>
        <div className="mt-6 h-[2px] bg-rule" />

        {/* Layout */}
        <div className="mt-8">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-headline text-[20px] font-bold tracking-wide">Layout</h3>
            <div className="flex items-center gap-3">
              <Link
                href={`/dashboard/groups/${id}/layout`}
                className="font-headline font-bold text-[14px] tracking-wide bg-ink text-white px-5 py-2.5 hover:bg-maroon transition-colors"
              >
                Configure Layout
              </Link>
            </div>
          </div>
          <p className="font-headline text-[14px] text-caption">
            {group.blocks.length === 0
              ? "No layout configured yet. Click Configure Layout to start building."
              : `${mainBlocks.length} main blocks, ${sidebarBlocks.length} sidebar blocks`
            }
          </p>
        </div>
      </div>
    </div>
  );
}
