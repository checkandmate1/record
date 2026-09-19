import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkRole } from "@/lib/middleware/auth";
import { updateArticleSchema } from "@/lib/validations";
import { sanitizeHtml } from "@/lib/sanitize";
import { errorResponse } from "@/lib/errors";
import { isEditorRole } from "@/lib/roles";

// Public-safe projection: drop email, isAdmin, googleImage, emailVerified, createdAt, updatedAt.
const publicUserSelect = {
  id: true,
  name: true,
  image: true,
  role: true,
  displayTitle: true,
  encryptedDek: true,
  dekKekVersion: true,
  nameCiphertext: true,
  imageCiphertext: true,
} as const;

const articleInclude = {
  createdBy: { select: publicUserSelect },
  credits: { include: { user: { select: publicUserSelect } } },
  images: { orderBy: { order: "asc" as const } },
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await auth();
  const role = session?.user?.role;
  const canSeeDrafts = isEditorRole(role);

  // Editors+ can fetch any article by id; everyone else only PUBLISHED, matching /api/articles
  // and /api/articles/by-slug behavior. Without this filter, any signed-in user could read drafts by id.
  const article = canSeeDrafts
    ? await prisma.article.findUnique({
        where: { id },
        include: articleInclude,
      })
    : await prisma.article.findFirst({
        where: { id, group: { status: "PUBLISHED" } },
        include: articleInclude,
      });

  if (!article) {
    return errorResponse("NOT_FOUND", "Article not found", 404);
  }

  return NextResponse.json(article);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await checkRole("WRITER");
  if (error) return error;

  const { id } = await params;

  const existing = await prisma.article.findUnique({ where: { id } });
  if (!existing) {
    return errorResponse("NOT_FOUND", "Article not found", 404);
  }

  // Ownership-or-editor gate: writers may edit their own drafts; only EDITOR+ may edit others'.
  if (
    existing.createdById !== session.user.id &&
    !isEditorRole(session.user.role)
  ) {
    return errorResponse("FORBIDDEN", "You can only modify your own articles", 403);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse("BAD_REQUEST", "Invalid JSON body", 400);
  }

  const parsed = updateArticleSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);
  }

  const { title, body: articleBody, excerpt, featuredImage, section, credits, images } = parsed.data;

  const sanitizedBody = articleBody !== undefined ? sanitizeHtml(articleBody) : undefined;

  // Replace credits if provided
  if (credits !== undefined) {
    await prisma.articleCredit.deleteMany({ where: { articleId: id } });
  }

  // Replace images if provided
  if (images !== undefined) {
    await prisma.articleImage.deleteMany({ where: { articleId: id } });
  }

  // Cast around the Phase 5 schema requiring ciphertext fields on nested creates.
  const article = await prisma.article.update({
    where: { id },
    data: {
      ...(title !== undefined && { title }),
      ...(sanitizedBody !== undefined && { body: sanitizedBody }),
      ...(excerpt !== undefined && { excerpt }),
      ...(featuredImage !== undefined && { featuredImage }),
      ...(section !== undefined && { section }),
      ...(credits !== undefined && { credits: { create: credits } as never }),
      ...(images !== undefined && { images: { create: images } as never }),
    },
    include: articleInclude,
  });

  return NextResponse.json(article);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await checkRole("WRITER");
  if (error) return error;

  const { id } = await params;

  const existing = await prisma.article.findUnique({ where: { id } });
  if (!existing) {
    return errorResponse("NOT_FOUND", "Article not found", 404);
  }

  // Ownership-or-editor gate: writers may delete their own drafts; only EDITOR+ may delete others'.
  if (
    existing.createdById !== session.user.id &&
    !isEditorRole(session.user.role)
  ) {
    return errorResponse("FORBIDDEN", "You can only delete your own articles", 403);
  }

  await prisma.article.delete({ where: { id } });

  return NextResponse.json({ message: "Article deleted successfully" });
}
