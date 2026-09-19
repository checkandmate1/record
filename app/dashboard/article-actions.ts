"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sanitizeHtml } from "@/lib/sanitize";
import { generateUniqueSlug } from "@/lib/slugify";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { invalidateHomepage } from "@/lib/page-cache";
import { isDashboardRole, isEditorRole } from "@/lib/roles";
import {
  articleActionSchema,
  MAX_ARTICLE_CREDITS,
  type ArticleActionInput,
} from "@/lib/validations";

const CREDIT_USER_RE = /^credit_user_(\d+)$/;
const CREDIT_ROLE_RE = /^credit_role_(\d+)$/;

// Interactive transactions default to a 5 s timeout. Each encrypted row write costs a KMS
// GenerateDataKey round trip (lib/CLAUDE.md), so 50 credits can legitimately need longer.
const TX_TIMEOUT_MS = 20_000;

/**
 * Collect `credit_user_<i>` / `credit_role_<i>` pairs by walking the submitted FormData.
 *
 * The previous implementation trusted a `credit_count` field and looped that many times, so a
 * forged `credit_count=10000000` turned one POST into ten million map lookups. Iterating the
 * real entries bounds the work at the request body; the explicit cap bounds it again and lets
 * Zod produce a clean error instead of silently truncating.
 */
function parseCredits(formData: FormData): { userId: string; creditRole: string }[] {
  const users = new Map<number, string>();
  const roles = new Map<number, string>();

  for (const [key, value] of formData.entries()) {
    if (typeof value !== "string") continue;

    const userMatch = CREDIT_USER_RE.exec(key);
    if (userMatch) {
      // Allow one past the cap so the schema can reject rather than silently drop credits.
      if (users.size <= MAX_ARTICLE_CREDITS) users.set(Number(userMatch[1]), value);
      continue;
    }

    const roleMatch = CREDIT_ROLE_RE.exec(key);
    if (roleMatch && roles.size <= MAX_ARTICLE_CREDITS) {
      roles.set(Number(roleMatch[1]), value);
    }
  }

  const credits: { userId: string; creditRole: string }[] = [];
  for (const index of [...users.keys()].sort((a, b) => a - b)) {
    const userId = users.get(index)!;
    const creditRole = roles.get(index);
    if (userId && creditRole) credits.push({ userId, creditRole });
  }
  return credits;
}

function firstIssue(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? "Invalid article";
}

/** Shared shape checks for create and update. Throws with a user-facing message. */
function parseArticleForm(formData: FormData): ArticleActionInput {
  const title = (formData.get("title") as string) ?? "";
  const body = (formData.get("body") as string) ?? "";
  const section = (formData.get("section") as string) ?? "";
  const featuredImage = (formData.get("featuredImage") as string) || null;

  if (!title || !body || !section) {
    throw new Error("Title, body, and section are required");
  }

  if (title.trim().toLowerCase() === "media") {
    throw new Error("Articles cannot be titled 'Media'");
  }

  const parsed = articleActionSchema.safeParse({
    title,
    body,
    section,
    featuredImage,
    credits: parseCredits(formData),
  });
  if (!parsed.success) {
    throw new Error(firstIssue(parsed.error));
  }
  return parsed.data;
}

function requireDashboardRole(session: { user?: { role?: string } } | null) {
  if (!isDashboardRole(session?.user?.role)) {
    throw new Error("Dashboard access required");
  }
}

export async function createArticleInGroup(groupId: string, formData: FormData) {
  const session = await auth();
  requireDashboardRole(session);

  const group = await prisma.articleGroup.findUnique({
    where: { id: groupId },
    select: { id: true, status: true },
  });
  if (!group) {
    throw new Error("Group not found");
  }

  // A published issue is live on the homepage; only EDITOR+ may change what readers see.
  if (group.status === "PUBLISHED" && !isEditorRole(session?.user?.role)) {
    throw new Error("Only editors can add articles to a published issue");
  }

  const data = parseArticleForm(formData);
  const slug = await generateUniqueSlug(data.title);

  await prisma.article.create({
    data: {
      title: data.title,
      slug,
      body: sanitizeHtml(data.body),
      featuredImage: data.featuredImage ?? null,
      section: data.section,
      createdById: session!.user!.id,
      credits: data.credits.length > 0 ? { create: data.credits } : undefined,
      groupId,
    } as never,
  });

  revalidatePath(`/dashboard/groups/${groupId}`);
  revalidatePath("/dashboard");
  revalidatePath("/");
  invalidateHomepage();
  redirect(`/dashboard/groups/${groupId}`);
}

export async function updateArticle(id: string, formData: FormData) {
  const session = await auth();
  requireDashboardRole(session);

  const existing = await prisma.article.findUnique({
    where: { id },
    select: { createdById: true, group: { select: { status: true } } },
  });
  if (!existing) {
    throw new Error("Article not found");
  }

  // Writers may edit their own articles; only EDITOR+ may edit others'. Mirrors deleteArticle
  // and app/api/articles/[id]/route.ts.
  const isEditorPlus = isEditorRole(session?.user?.role);
  if (existing.createdById !== session!.user!.id && !isEditorPlus) {
    throw new Error("You can only edit your own articles");
  }
  // Once an issue is published the article is live; editing it is an EDITOR+ act even for the
  // article's own author.
  if (!isEditorPlus && existing.group?.status === "PUBLISHED") {
    throw new Error("Only editors can edit published articles");
  }

  const data = parseArticleForm(formData);

  // Credits are "delete all, recreate" (app/dashboard/CLAUDE.md). Without a transaction a
  // failure between the two steps left the article with no authors at all.
  await prisma.$transaction(
    async (tx) => {
      await tx.articleCredit.deleteMany({ where: { articleId: id } });
      await tx.article.update({
        where: { id },
        data: {
          title: data.title,
          body: sanitizeHtml(data.body),
          featuredImage: data.featuredImage ?? null,
          section: data.section,
          credits: data.credits.length > 0 ? ({ create: data.credits } as never) : undefined,
        },
      });
    },
    { timeout: TX_TIMEOUT_MS },
  );

  revalidatePath("/dashboard");
  revalidatePath("/");
  invalidateHomepage();
  redirect("/dashboard?saved=1");
}

export async function deleteArticle(id: string) {
  const session = await auth();
  requireDashboardRole(session);

  const existing = await prisma.article.findUnique({
    where: { id },
    select: { createdById: true },
  });
  if (!existing) {
    throw new Error("Article not found");
  }

  // Writers may delete their own articles; only EDITOR+ may delete others'.
  const isOwner = existing.createdById === session!.user!.id;
  const isEditorPlus = isEditorRole(session?.user?.role);
  if (!isOwner && !isEditorPlus) {
    throw new Error("You can only delete your own articles");
  }

  await prisma.article.delete({ where: { id } });

  revalidatePath("/");
  invalidateHomepage();
  revalidatePath("/dashboard");
  redirect("/dashboard");
}

export async function approveArticle(articleId: string) {
  const session = await auth();
  requireDashboardRole(session);

  await prisma.approval.create({
    data: { userId: session!.user!.id, articleId },
  });

  revalidatePath(`/dashboard/articles/${articleId}/edit`);
}

export async function removeArticleApproval(approvalId: string, articleId: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");

  const approval = await prisma.approval.findUnique({ where: { id: approvalId } });
  if (!approval) throw new Error("Approval not found");

  // Users can remove their own approval; EDITOR+ can remove anyone's
  if (approval.userId !== session.user.id && !isEditorRole(session.user.role)) {
    throw new Error("You can only remove your own approval");
  }

  await prisma.approval.delete({ where: { id: approvalId } });

  revalidatePath(`/dashboard/articles/${articleId}/edit`);
}
