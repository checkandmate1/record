import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getS3ObjectStream } from "@/lib/s3";
import { errorResponse } from "@/lib/errors";
import { isDashboardRole } from "@/lib/roles";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return errorResponse("UNAUTHORIZED", "Sign in required", 401);
  }

  // Defense in depth: re-verify the email domain even though the sign-in callback
  // enforces it. Catches the case where the callback ever loosens or a second auth
  // provider is added without updating this route.
  if (!session.user.email?.endsWith("@horacemann.org")) {
    return errorResponse("FORBIDDEN", "HM account required", 403);
  }

  const { id } = await params;

  const group = await prisma.articleGroup.findUnique({
    where: { id },
    select: { id: true, status: true, pdfKey: true, pdfFilename: true },
  });
  if (!group?.pdfKey) {
    return errorResponse("NOT_FOUND", "Issue PDF not found", 404);
  }

  // Visibility gate. PUBLISHED → any HM user. DRAFT/ARCHIVED → only dashboard roles
  // (WRITER+) so editors can preview before publish.
  if (group.status !== "PUBLISHED" && !isDashboardRole(session.user.role)) {
    return errorResponse("FORBIDDEN", "This issue is not yet published", 403);
  }

  // Append-only audit log row. Failure here is logged but does NOT block the fetch —
  // we'd rather the user gets the PDF and we lose one audit row than the reverse.
  prisma.issuePdfAccess
    .create({ data: { userId: session.user.id, groupId: group.id } })
    .catch((e: unknown) => {
      console.error(`[issuePdf] audit log write failed for user ${session.user.id} group ${group.id}:`, e);
    });

  const { body, contentLength, contentType } = await getS3ObjectStream(group.pdfKey);

  // inline disposition so the browser's PDF viewer renders it instead of forcing
  // a download. The original filename is included so "save as" defaults to it.
  const safeName = (group.pdfFilename ?? "issue.pdf").replace(/[^\w.\-]/g, "_");
  const headers = new Headers({
    "Content-Type": contentType ?? "application/pdf",
    "Content-Disposition": `inline; filename="${safeName}"`,
    "Cache-Control": "private, no-store",
  });
  if (contentLength != null) headers.set("Content-Length", String(contentLength));

  return new NextResponse(body, { status: 200, headers });
}
