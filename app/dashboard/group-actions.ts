"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { invalidateHomepage } from "@/lib/page-cache";
import { isDashboardRole, isEditorRole } from "@/lib/roles";
import { PATTERNS } from "@/lib/patterns";
import { deleteS3Object, getS3ObjectHead } from "@/lib/s3";
import { parseIssuePdfKey } from "@/lib/validations";

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

function parsePositiveInt(raw: FormDataEntryValue | null): number | null {
  if (raw === null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function createGroup(formData: FormData) {
  const session = await auth();
  requireEditor(session);

  const issueNumber = parsePositiveInt(formData.get("issueNumber"));
  const volumeNumber = parsePositiveInt(formData.get("volumeNumber"));

  const group = await prisma.articleGroup.create({
    data: { volumeNumber, issueNumber },
  });

  redirect(`/dashboard/groups/${group.id}`);
}

export async function updateGroup(id: string, formData: FormData) {
  const session = await auth();
  requireEditor(session);

  const issueNumber = parsePositiveInt(formData.get("issueNumber"));
  const volumeNumber = parsePositiveInt(formData.get("volumeNumber"));

  await prisma.articleGroup.update({
    where: { id },
    data: { volumeNumber, issueNumber },
  });

  revalidatePath(`/dashboard/groups/${id}`);
  revalidatePath("/");
  invalidateHomepage();
  redirect(`/dashboard/groups/${id}?saved=1`);
}

export async function publishGroup(id: string) {
  const session = await auth();
  requireEditor(session);

  // An issue can't go public without a volume + issue number — those identify the edition
  // everywhere (homepage masthead, search-by-"Issue X Volume X", the issue PDF label).
  const group = await prisma.articleGroup.findUnique({
    where: { id },
    select: { volumeNumber: true, issueNumber: true },
  });
  if (!group) throw new Error("Issue not found");
  if (group.volumeNumber == null || group.issueNumber == null) {
    throw new Error("Set a volume number and issue number before publishing this issue.");
  }

  await prisma.articleGroup.update({
    where: { id },
    data: { status: "PUBLISHED", publishedAt: new Date() },
  });

  revalidatePath("/");
  invalidateHomepage();
  revalidatePath("/dashboard");
  redirect(`/dashboard/groups/${id}`);
}

export async function unpublishGroup(id: string) {
  const session = await auth();
  requireEditor(session);

  await prisma.articleGroup.update({
    where: { id },
    data: { status: "DRAFT", publishedAt: null },
  });

  revalidatePath("/");
  invalidateHomepage();
  revalidatePath("/dashboard");
  redirect(`/dashboard/groups/${id}`);
}

export async function scheduleGroup(id: string, formData: FormData) {
  const session = await auth();
  requireEditor(session);

  const scheduledAt = formData.get("scheduledAt") as string;
  const date = new Date(scheduledAt);
  if (isNaN(date.getTime())) throw new Error("Invalid date");

  await prisma.articleGroup.update({
    where: { id },
    data: { scheduledAt: date },
  });

  revalidatePath(`/dashboard/groups/${id}`);
}

export async function deleteGroup(id: string) {
  const session = await auth();
  requireEditor(session);

  // Pull the PDF key first so we can clean up S3 after the row is gone. Cascade-delete on
  // the group covers DB rows but doesn't touch object storage.
  const group = await prisma.articleGroup.findUnique({
    where: { id },
    select: { pdfKey: true },
  });

  await prisma.articleGroup.delete({ where: { id } });

  if (group?.pdfKey) {
    await deleteS3Object(group.pdfKey).catch((e) => {
      console.error(`[deleteGroup] failed to delete PDF ${group.pdfKey}:`, e);
    });
  }

  revalidatePath("/dashboard");
  redirect("/dashboard");
}

// Attach a PDF to an issue. The client uploads via presigned PUT first (POST
// /api/upload/issue-pdf) and then calls this with the resulting S3 key. We re-validate
// the key shape to reject swapped keys, verify magic bytes to reject renamed binaries
// (the presigned-PUT Content-Type is client-asserted), and replace any prior PDF.
export async function setIssuePdf(
  groupId: string,
  key: string,
  filename: string,
  byteSize: number,
): Promise<void> {
  const session = await auth();
  requireEditor(session);

  const parsed = parseIssuePdfKey(key);
  if (!parsed || parsed.groupId !== groupId) {
    throw new Error("Invalid PDF key");
  }

  // Magic-byte check. Real PDFs start with "%PDF" (0x25 0x50 0x44 0x46). A renamed
  // image/exe/anything else fails this. If the check fails we delete the just-uploaded
  // S3 object so we don't leave garbage in the bucket.
  const head = await getS3ObjectHead(key, 4);
  const isPdf =
    head.length >= 4 &&
    head[0] === 0x25 &&
    head[1] === 0x50 &&
    head[2] === 0x44 &&
    head[3] === 0x46;
  if (!isPdf) {
    await deleteS3Object(key).catch(() => {});
    throw new Error("Uploaded file is not a valid PDF");
  }

  const existing = await prisma.articleGroup.findUnique({
    where: { id: groupId },
    select: { pdfKey: true },
  });

  await prisma.articleGroup.update({
    where: { id: groupId },
    data: {
      pdfKey: key,
      pdfFilename: filename.slice(0, 255),
      pdfByteSize: byteSize,
      pdfUploadedAt: new Date(),
    },
  });

  if (existing?.pdfKey && existing.pdfKey !== key) {
    await deleteS3Object(existing.pdfKey).catch((e) => {
      console.error(`[setIssuePdf] failed to delete old PDF ${existing.pdfKey}:`, e);
    });
  }

  revalidatePath("/");
  revalidatePath(`/dashboard/groups/${groupId}`);
  invalidateHomepage();
}

export async function removeIssuePdf(groupId: string): Promise<void> {
  const session = await auth();
  requireEditor(session);

  const existing = await prisma.articleGroup.findUnique({
    where: { id: groupId },
    select: { pdfKey: true },
  });

  await prisma.articleGroup.update({
    where: { id: groupId },
    data: {
      pdfKey: null,
      pdfFilename: null,
      pdfByteSize: null,
      pdfUploadedAt: null,
    },
  });

  if (existing?.pdfKey) {
    await deleteS3Object(existing.pdfKey).catch((e) => {
      console.error(`[removeIssuePdf] failed to delete PDF ${existing.pdfKey}:`, e);
    });
  }

  revalidatePath("/");
  revalidatePath(`/dashboard/groups/${groupId}`);
  invalidateHomepage();
}

export async function approveGroup(groupId: string) {
  const session = await auth();
  requireDashboardRole(session);

  await prisma.approval.create({
    data: { userId: session!.user!.id, groupId },
  });

  revalidatePath(`/dashboard/groups/${groupId}`);
}

export async function removeGroupApproval(approvalId: string, groupId: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");

  const approval = await prisma.approval.findUnique({ where: { id: approvalId } });
  if (!approval) throw new Error("Approval not found");

  if (approval.userId !== session.user.id && !isEditorRole(session.user.role)) {
    throw new Error("You can only remove your own approval");
  }

  await prisma.approval.delete({ where: { id: approvalId } });

  revalidatePath(`/dashboard/groups/${groupId}`);
}

export async function createGroupWithArticles(formData: FormData) {
  const session = await auth();
  requireEditor(session);

  const issueNumber = parsePositiveInt(formData.get("issueNumber"));
  const volumeNumber = parsePositiveInt(formData.get("volumeNumber"));
  const articleIds = formData.getAll("articleIds") as string[];

  const group = await prisma.articleGroup.create({
    data: {
      volumeNumber,
      issueNumber,
      articles: articleIds.length > 0
        ? { connect: articleIds.map((id) => ({ id })) }
        : undefined,
    },
  });

  redirect(`/dashboard/groups/${group.id}`);
}

export async function addBlock(groupId: string, column: string, pattern: string) {
  const session = await auth();
  requireDashboardRole(session);

  const patternDef = PATTERNS[pattern];
  if (!patternDef) throw new Error("Unknown pattern");
  if (patternDef.column !== column) throw new Error("Pattern not valid for this column");

  const lastBlock = await prisma.layoutBlock.findFirst({
    where: { groupId, column },
    orderBy: { order: "desc" },
  });
  const nextOrder = (lastBlock?.order ?? -1) + 1;

  await prisma.layoutBlock.create({
    data: {
      groupId,
      column,
      pattern,
      order: nextOrder,
      slots: {
        create: patternDef.slots.map((s, i) => ({
          slotRole: s.role,
          order: i,
        })),
      },
    },
  });

  revalidatePath(`/dashboard/groups/${groupId}`);
  revalidatePath("/");
  invalidateHomepage();
}

export async function deleteBlock(blockId: string, groupId: string) {
  const session = await auth();
  requireDashboardRole(session);

  await prisma.layoutBlock.delete({ where: { id: blockId } });

  revalidatePath(`/dashboard/groups/${groupId}`);
  revalidatePath("/");
  invalidateHomepage();
}

export async function reorderBlocks(groupId: string, column: string, blockIds: string[]) {
  const session = await auth();
  requireDashboardRole(session);

  await Promise.all(
    blockIds.map((id, i) =>
      prisma.layoutBlock.update({ where: { id }, data: { order: i } })
    )
  );

  revalidatePath(`/dashboard/groups/${groupId}`);
  revalidatePath("/");
  invalidateHomepage();
}

export async function updateDividerStyle(blockId: string, style: string, groupId: string) {
  const session = await auth();
  requireDashboardRole(session);

  await prisma.layoutBlock.update({
    where: { id: blockId },
    data: { dividerStyle: style },
  });

  revalidatePath(`/dashboard/groups/${groupId}`);
  revalidatePath("/");
  invalidateHomepage();
}

export async function assignToBlockSlot(slotId: string, articleId: string | null, groupId: string) {
  const session = await auth();
  requireDashboardRole(session);

  await prisma.blockSlot.update({
    where: { id: slotId },
    data: {
      articleId: articleId || null,
    },
  });

  revalidatePath(`/dashboard/groups/${groupId}`);
  revalidatePath("/");
  invalidateHomepage();
}

export async function assignMediaToBlockSlot(
  slotId: string,
  mediaUrl: string,
  mediaType: string,
  mediaAlt: string,
  mediaCredit: string,
  groupId: string,
) {
  const session = await auth();
  requireDashboardRole(session);

  await prisma.blockSlot.update({
    where: { id: slotId },
    data: { mediaUrl, mediaType, mediaAlt, mediaCredit },
  });

  revalidatePath(`/dashboard/groups/${groupId}`);
  revalidatePath("/");
  invalidateHomepage();
}

export async function clearBlockSlot(slotId: string, groupId: string) {
  const session = await auth();
  requireDashboardRole(session);

  await prisma.blockSlot.updateMany({
    where: { id: slotId },
    data: { articleId: null, mediaUrl: null, mediaType: null, mediaAlt: null, mediaCredit: null },
  });

  revalidatePath(`/dashboard/groups/${groupId}`);
  revalidatePath(`/dashboard/groups/${groupId}/layout`);
  revalidatePath("/");
  invalidateHomepage();
}

export async function clearSlotArticle(slotId: string, groupId: string) {
  const session = await auth();
  requireDashboardRole(session);

  await prisma.blockSlot.updateMany({
    where: { id: slotId },
    data: { articleId: null },
  });

  revalidatePath(`/dashboard/groups/${groupId}`);
  revalidatePath(`/dashboard/groups/${groupId}/layout`);
  revalidatePath("/");
  invalidateHomepage();
}

export async function updateSlotScale(slotId: string, scale: string, groupId: string) {
  const session = await auth();
  requireDashboardRole(session);

  if (!["S", "M", "L", "XL"].includes(scale)) throw new Error("Invalid scale");

  await prisma.blockSlot.update({
    where: { id: slotId },
    data: { scale },
  });

  revalidatePath(`/dashboard/groups/${groupId}`);
  revalidatePath(`/dashboard/groups/${groupId}/layout`);
  revalidatePath("/");
  invalidateHomepage();
}

export async function updateSlotImageScale(slotId: string, imageScale: string, groupId: string) {
  const session = await auth();
  requireDashboardRole(session);

  if (!["S", "M", "L", "XL"].includes(imageScale)) throw new Error("Invalid scale");

  await prisma.blockSlot.update({
    where: { id: slotId },
    data: { imageScale },
  });

  revalidatePath(`/dashboard/groups/${groupId}`);
  revalidatePath(`/dashboard/groups/${groupId}/layout`);
  revalidatePath("/");
  invalidateHomepage();
}

export async function updateSlotPreviewLength(slotId: string, length: number, groupId: string) {
  const session = await auth();
  requireDashboardRole(session);

  const clamped = Math.max(50, Math.min(500, Math.round(length)));
  await prisma.blockSlot.update({
    where: { id: slotId },
    data: { previewLength: clamped },
  });

  revalidatePath("/");
  invalidateHomepage();
}

export async function toggleSlotFeatured(slotId: string, featured: boolean, groupId: string) {
  const session = await auth();
  requireDashboardRole(session);

  await prisma.blockSlot.update({
    where: { id: slotId },
    data: { featured },
  });

  revalidatePath(`/dashboard/groups/${groupId}/layout`);
  revalidatePath("/");
  invalidateHomepage();
}

export async function toggleSlotByline(slotId: string, showByline: boolean, groupId: string) {
  const session = await auth();
  requireDashboardRole(session);

  await prisma.blockSlot.update({
    where: { id: slotId },
    data: { showByline },
  });

  revalidatePath(`/dashboard/groups/${groupId}/layout`);
  revalidatePath("/");
  invalidateHomepage();
}

export async function updateImageFloat(slotId: string, imageFloat: string, groupId: string) {
  const session = await auth();
  requireDashboardRole(session);

  if (!["left", "right", "full"].includes(imageFloat)) throw new Error("Invalid imageFloat");

  await prisma.blockSlot.update({
    where: { id: slotId },
    data: { imageFloat },
  });

  revalidatePath(`/dashboard/groups/${groupId}`);
  revalidatePath(`/dashboard/groups/${groupId}/layout`);
  revalidatePath("/");
  invalidateHomepage();
}

export async function updateImageWidth(slotId: string, imageWidth: number, groupId: string) {
  const session = await auth();
  requireDashboardRole(session);

  const clamped = Math.max(10, Math.min(100, Math.round(imageWidth)));
  await prisma.blockSlot.update({
    where: { id: slotId },
    data: { imageWidth: clamped },
  });

  revalidatePath(`/dashboard/groups/${groupId}`);
  revalidatePath(`/dashboard/groups/${groupId}/layout`);
  revalidatePath("/");
  invalidateHomepage();
}

export async function updateImageCrop(slotId: string, imageCrop: string, imageCropCustom: string | null, groupId: string) {
  const session = await auth();
  requireDashboardRole(session);

  if (!["original", "landscape", "portrait", "square", "custom"].includes(imageCrop)) throw new Error("Invalid imageCrop");

  await prisma.blockSlot.update({
    where: { id: slotId },
    data: { imageCrop, imageCropCustom: imageCrop === "custom" ? imageCropCustom : null },
  });

  revalidatePath(`/dashboard/groups/${groupId}`);
  revalidatePath(`/dashboard/groups/${groupId}/layout`);
  revalidatePath("/");
  invalidateHomepage();
}

export async function updateMediaCredit(slotId: string, mediaCredit: string, groupId: string) {
  const session = await auth();
  requireDashboardRole(session);

  await prisma.blockSlot.update({
    where: { id: slotId },
    data: { mediaCredit },
  });

  revalidatePath(`/dashboard/groups/${groupId}`);
  revalidatePath(`/dashboard/groups/${groupId}/layout`);
  revalidatePath("/");
  invalidateHomepage();
}

export async function clearSlotMedia(slotId: string, groupId: string) {
  const session = await auth();
  requireDashboardRole(session);

  await prisma.blockSlot.updateMany({
    where: { id: slotId },
    data: { mediaUrl: null, mediaType: null, mediaAlt: null, mediaCredit: null },
  });

  revalidatePath(`/dashboard/groups/${groupId}`);
  revalidatePath(`/dashboard/groups/${groupId}/layout`);
  revalidatePath("/");
  invalidateHomepage();
}
