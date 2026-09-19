"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sanitizeHtml } from "@/lib/sanitize";
import { generateUniqueSlug } from "@/lib/slugify";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { invalidateHomepage } from "@/lib/page-cache";
import { isDashboardRole, isEditorRole } from "@/lib/roles";

function parseCredits(formData: FormData) {
  const count = parseInt(formData.get("credit_count") as string, 10) || 0;
  const credits: { userId: string; creditRole: string }[] = [];
  for (let i = 0; i < count; i++) {
    const userId = formData.get(`credit_user_${i}`) as string;
    const creditRole = formData.get(`credit_role_${i}`) as string;
    if (userId && creditRole) {
      credits.push({ userId, creditRole });
    }
  }
  return credits;
}

function requireDashboardRole(session: { user?: { role?: string } } | null) {
  if (!isDashboardRole(session?.user?.role)) {
    throw new Error("Dashboard access required");
  }
}

function requireEditor(session: { user?: { role?: string } } | null) {
  if (!isEditorRole(session?.user?.role)) {
    throw new Error("Editor access required");
  }
}

export async function createArticleInGroup(groupId: string, formData: FormData) {
  const session = await auth();
  requireDashboardRole(session);

  const title = formData.get("title") as string;
  const body = formData.get("body") as string;
  const section = formData.get("section") as string;
  const featuredImage = (formData.get("featuredImage") as string) || null;
  const credits = parseCredits(formData);

  if (!title || !body || !section) {
    throw new Error("Title, body, and section are required");
  }

  if (title.trim().toLowerCase() === "media") {
    throw new Error("Articles cannot be titled 'Media'");
  }

  const slug = await generateUniqueSlug(title);

  await prisma.article.create({
    data: {
      title,
      slug,
      body: sanitizeHtml(body),
      featuredImage,
      section: section as "NEWS" | "OPINIONS" | "LIONS_DEN" | "A_AND_E" | "FEATURES" | "THE_ROUNDTABLE" | "MD_ALUMNI",
      createdById: session!.user!.id,
      credits: credits.length > 0 ? { create: credits } : undefined,
      groupId,
    } as never,
  });

  redirect(`/dashboard/groups/${groupId}`);
}

export async function updateArticle(id: string, formData: FormData) {
  const session = await auth();
  requireDashboardRole(session);

  const title = formData.get("title") as string;
  const body = formData.get("body") as string;
  const section = formData.get("section") as string;
  const featuredImage = (formData.get("featuredImage") as string) || null;
  const credits = parseCredits(formData);

  if (!title || !body || !section) {
    throw new Error("Title, body, and section are required");
  }

  if (title.trim().toLowerCase() === "media") {
    throw new Error("Articles cannot be titled 'Media'");
  }

  await prisma.articleCredit.deleteMany({ where: { articleId: id } });

  await prisma.article.update({
    where: { id },
    data: {
      title,
      body: sanitizeHtml(body),
      featuredImage,
      section: section as "NEWS" | "OPINIONS" | "LIONS_DEN" | "A_AND_E" | "FEATURES" | "THE_ROUNDTABLE" | "MD_ALUMNI",
      credits: credits.length > 0 ? ({ create: credits } as never) : undefined,
    },
  });

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
