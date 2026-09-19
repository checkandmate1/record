import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { issuePdfUploadRequestSchema } from "@/lib/validations";
import { createPresignedUploadUrl } from "@/lib/s3";
import { errorResponse } from "@/lib/errors";
import { randomUUID } from "crypto";
import { isEditorRole } from "@/lib/roles";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return errorResponse("UNAUTHORIZED", "Sign in required", 401);
  }
  if (!isEditorRole(session.user.role)) {
    return errorResponse("FORBIDDEN", "Editor access required", 403);
  }

  const body = await req.json();
  const parsed = issuePdfUploadRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("BAD_REQUEST", parsed.error.issues[0]?.message ?? "Invalid request");
  }

  const { contentType, contentLength, groupId } = parsed.data;

  // Refuse to mint upload URLs for non-existent issues. Cheap guard against typos and
  // attempts to dump PDFs in the bucket without ever writing to a real ArticleGroup row.
  const group = await prisma.articleGroup.findUnique({
    where: { id: groupId },
    select: { id: true },
  });
  if (!group) {
    return errorResponse("NOT_FOUND", "Issue not found", 404);
  }

  const key = `issue-pdfs/${groupId}/${randomUUID()}.pdf`;
  const uploadUrl = await createPresignedUploadUrl(key, contentType, contentLength);

  // No publicUrl — the file is private. Access goes through GET /api/issues/[id]/pdf
  // which streams the bytes through the Next.js server.
  return NextResponse.json({ uploadUrl, key });
}
