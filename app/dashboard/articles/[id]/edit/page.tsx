import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { userMinimalNameSelect, userMinimalNameImageSelect, userPublicSelect } from "@/lib/prisma-selects";
import { SubpageHeader } from "@/app/subpage-header";
import { ArticleForm } from "@/app/dashboard/article-form";
import {
  updateArticle,
  deleteArticle,
} from "@/app/dashboard/article-actions";
import { ApprovalDisplay } from "@/app/dashboard/approval-display";
import { approveArticle, removeArticleApproval } from "@/app/dashboard/article-actions";
import { joinAuthorNames } from "@/lib/article-helpers";
import { isEditorRole, roleLabel } from "@/lib/roles";

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function EditArticlePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { id } = await params;

  const [article, allUsers] = await Promise.all([
    prisma.article.findUnique({
      where: { id },
      include: {
        credits: { include: { user: { select: userPublicSelect } } },
        approvals: {
          include: { user: { select: userMinimalNameImageSelect } },
          orderBy: { createdAt: "asc" as const },
        },
        group: { select: { status: true, name: true } },
      },
    }),
    prisma.user.findMany({
      select: userPublicSelect,
      orderBy: { name: "asc" },
    }),
  ]);

  if (!article) notFound();

  const approvers = (article.approvals ?? []).map((a: any) => ({
    id: a.user.id,
    approvalId: a.id,
    name: a.user.name,
    image: a.user.image,
  }));
  const hasApproved = approvers.some((a: any) => a.id === session.user.id);
  const canManage = isEditorRole(session.user.role);

  const existingCredits = article.credits.map((c: (typeof article.credits)[number]) => ({
    userId: c.user.id,
    userName: c.user.name ?? "",
    creditRole: c.creditRole ?? "",
  }));

  const boundUpdate = updateArticle.bind(null, id);
  const boundDelete = deleteArticle.bind(null, id);

  // Build user list with default display titles for the form
  const usersWithDefaults = allUsers.map((u: (typeof allUsers)[number]) => ({
    id: u.id,
    name: u.name ?? "",
    defaultRole: (u as { displayTitle?: string | null }).displayTitle ?? roleLabel(u.role),
  }));

  return (
    <div className="min-h-screen flex flex-col bg-white font-body page-enter">
      <SubpageHeader pageLabel="Edit Article" />

      <div className="max-w-[800px] mx-auto px-4 sm:px-8 pt-8 pb-16">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-headline text-[28px] sm:text-[34px] font-bold tracking-wide leading-tight">
              Edit Article
            </h2>
            <p className="font-headline text-[13px] text-caption mt-1 tracking-wide">
              {joinAuthorNames(article.credits) ? (
                <>By {joinAuthorNames(article.credits)}</>
              ) : (
                <span className="italic">Uncredited</span>
              )}
              {" · "}
              Last updated {formatDate(article.updatedAt)}
            </p>
          </div>
        </div>
        <div className="mt-4">
          <ApprovalDisplay
            approvers={approvers}
            currentUserId={session.user.id}
            hasApproved={hasApproved}
            onApprove={async () => { "use server"; const { approveArticle } = await import("@/app/dashboard/article-actions"); await approveArticle(id); }}
            onRemoveApproval={async (approvalId: string) => { "use server"; const { removeArticleApproval } = await import("@/app/dashboard/article-actions"); await removeArticleApproval(approvalId, id); }}
            canRemoveOthers={canManage}
          />
        </div>
        <div className="mt-4 h-[2px] bg-rule" />

        {/* Action bar */}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          {article.group?.status === "PUBLISHED" && (
            <Link
              href={`/article/${article.slug}`}
              className="font-headline font-bold text-[14px] tracking-wide border border-ink/20 px-5 py-2 hover:border-maroon hover:text-maroon transition-colors"
            >
              View Live
            </Link>
          )}
          {canManage && (
            <form action={boundDelete} className="ml-auto">
              <button
                type="submit"
                className="cursor-pointer font-headline text-[13px] tracking-wide text-caption/50 hover:text-maroon transition-colors"
              >
                Delete
              </button>
            </form>
          )}
        </div>

        {/* Form */}
        <div className="mt-8">
          <ArticleForm
            action={boundUpdate}
            defaultValues={{
              title: article.title,
              body: article.body ?? "",
              section: article.section,
              featuredImage: article.featuredImage ?? null,
            }}
            defaultCredits={existingCredits}
            availableUsers={usersWithDefaults}
            submitLabel="Save Changes"
          />
        </div>

      </div>
    </div>
  );
}
