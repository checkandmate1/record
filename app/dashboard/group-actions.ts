"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { invalidateHomepage } from "@/lib/page-cache";
import { publishGroupById } from "@/lib/publish-group";
import { isDashboardRole, isEditorRole } from "@/lib/roles";
import { PATTERNS } from "@/lib/patterns";
import { deleteS3Object, getS3ObjectHead } from "@/lib/s3";
import { parseIssuePdfKey } from "@/lib/validations";
import {
  dividerStyleSchema,
  imageCropCustomSchema,
  imageCropSchema,
  imageFloatSchema,
  mediaCreditSchema,
  parseOrThrow,
  slotMediaSchema,
  slotScaleSchema,
} from "@/app/dashboard/group-schemas";
import type { Prisma } from "@prisma/client";

type SessionLike = { user?: { id?: string; role?: string } } | null;

function requireDashboardRole(session: SessionLike) {
  if (!isDashboardRole(session?.user?.role)) {
    throw new Error("Dashboard access required");
  }
}

function requireEditor(session: SessionLike) {
  if (!isEditorRole(session?.user?.role)) {
    throw new Error("Editor access required");
  }
}

/**
 * Once an issue is PUBLISHED its layout is live on the homepage, so only EDITOR+
 * may keep changing it. Drafts stay open to every dashboard role.
 *
 * Call this in every block/slot mutation *after* `requireDashboardRole`.
 */
async function requireGroupMutable(groupId: string, session: SessionLike) {
  const group = await prisma.articleGroup.findUnique({
    where: { id: groupId },
    select: { status: true },
  });
  if (!group) throw new Error("Issue not found");
  if (group.status === "PUBLISHED" && !isEditorRole(session?.user?.role)) {
    throw new Error("Only editors can change a published issue");
  }
}

/**
 * Slot and block ids arrive from the client, so every write is scoped to the
 * group the caller claims to be editing (`updateMany`/`deleteMany` because
 * Prisma's `update` only takes unique fields). A row outside the group updates
 * nothing — that is an error, not a silent no-op.
 *
 * `BlockSlot`/`LayoutBlock` hold no encrypted fields, so `updateMany` is safe
 * here (see `lib/CLAUDE.md` — encrypted models must use `where: { id }`).
 */
async function updateSlotInGroup(
  slotId: string,
  groupId: string,
  data: Prisma.BlockSlotUncheckedUpdateManyInput,
) {
  const { count } = await prisma.blockSlot.updateMany({
    where: { id: slotId, block: { groupId } },
    data,
  });
  if (count === 0) throw new Error("Slot is not part of this issue");
}

async function updateBlockInGroup(
  blockId: string,
  groupId: string,
  data: Prisma.LayoutBlockUncheckedUpdateManyInput,
) {
  const { count } = await prisma.layoutBlock.updateMany({
    where: { id: blockId, groupId },
    data,
  });
  if (count === 0) throw new Error("Block is not part of this issue");
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

  // Preconditions + write + cache invalidation live in lib/publish-group.ts so the scheduled
  // publisher (POST /api/cron/publish-scheduled) runs the exact same path.
  await publishGroupById(id);

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

// Accepts a full ISO 8601 instant with an explicit UTC offset ("…Z" or "…+05:30").
// A bare `datetime-local` value ("2026-09-20T18:00") is ambiguous: Node reads it in the
// server's zone (UTC on the Linode box), so an editor in New York silently schedules
// 4-5 hours off. The client must send `new Date(localValue).toISOString()`.
const ISO_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

export async function scheduleGroup(id: string, formData: FormData) {
  const session = await auth();
  requireEditor(session);

  const scheduledAt = String(formData.get("scheduledAt") ?? "").trim();
  if (!ISO_WITH_OFFSET.test(scheduledAt)) {
    throw new Error(
      "Scheduled time must be an ISO 8601 timestamp with a UTC offset (e.g. 2026-09-20T22:00:00.000Z)",
    );
  }

  const date = new Date(scheduledAt);
  if (isNaN(date.getTime())) throw new Error("Invalid date");
  if (date.getTime() <= Date.now()) {
    throw new Error("Scheduled time must be in the future");
  }

  // Prisma stores DateTime as UTC; `date` is already an absolute instant.
  await prisma.articleGroup.update({
    where: { id },
    data: { scheduledAt: date },
  });

  revalidatePath(`/dashboard/groups/${id}`);
  revalidatePath("/");
  invalidateHomepage();
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
  // Deleting a published issue changes the homepage; the in-process cache holds the
  // decrypted payload for 5 minutes unless we drop it here too.
  revalidatePath("/");
  invalidateHomepage();
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

  // The unique constraint stops a double approval; this stops an approval row
  // pointing at an issue that does not exist.
  const group = await prisma.articleGroup.findUnique({
    where: { id: groupId },
    select: { status: true },
  });
  if (!group) throw new Error("Issue not found");

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
  if (approval.groupId !== groupId) {
    throw new Error("Approval does not belong to this issue");
  }

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

  await requireGroupMutable(groupId, session);

  // MAX(order)+1 and the insert go in one transaction so two adds racing each other
  // can't land on the same `order`.
  await prisma.$transaction(async (tx) => {
    const lastBlock = await tx.layoutBlock.findFirst({
      where: { groupId, column },
      orderBy: { order: "desc" },
      select: { order: true },
    });
    const nextOrder = (lastBlock?.order ?? -1) + 1;

    await tx.layoutBlock.create({
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
  });

  revalidatePath(`/dashboard/groups/${groupId}`);
  revalidatePath("/");
  invalidateHomepage();
}

export async function deleteBlock(blockId: string, groupId: string) {
  const session = await auth();
  requireDashboardRole(session);
  await requireGroupMutable(groupId, session);

  const { count } = await prisma.layoutBlock.deleteMany({
    where: { id: blockId, groupId },
  });
  if (count === 0) throw new Error("Block is not part of this issue");

  revalidatePath(`/dashboard/groups/${groupId}`);
  revalidatePath("/");
  invalidateHomepage();
}

export async function reorderBlocks(groupId: string, column: string, blockIds: string[]) {
  const session = await auth();
  requireDashboardRole(session);
  await requireGroupMutable(groupId, session);

  // One *interactive* transaction, each update scoped to the group and the column, so a
  // stale or forged id list can't renumber blocks that belong somewhere else. The throw
  // has to happen inside the callback: `updateMany` matching nothing is not an error, and
  // the array form of `$transaction` would already have committed by the time we counted.
  await prisma.$transaction(async (tx) => {
    for (const [i, id] of blockIds.entries()) {
      const { count } = await tx.layoutBlock.updateMany({
        where: { id, groupId, column },
        data: { order: i },
      });
      if (count === 0) {
        throw new Error("A block in that order is not part of this issue");
      }
    }
  });

  revalidatePath(`/dashboard/groups/${groupId}`);
  revalidatePath("/");
  invalidateHomepage();
}

export async function updateDividerStyle(blockId: string, style: string, groupId: string) {
  const session = await auth();
  requireDashboardRole(session);
  await requireGroupMutable(groupId, session);

  const dividerStyle = parseOrThrow(dividerStyleSchema, style, "divider style");

  await updateBlockInGroup(blockId, groupId, { dividerStyle });

  revalidatePath(`/dashboard/groups/${groupId}`);
  revalidatePath("/");
  invalidateHomepage();
}

export async function assignToBlockSlot(slotId: string, articleId: string | null, groupId: string) {
  const session = await auth();
  requireDashboardRole(session);
  await requireGroupMutable(groupId, session);

  // Visibility is derived from the *article's* group, so a slot pointing at an article
  // from another (possibly draft) issue renders on the homepage with a 404 link.
  if (articleId) {
    const article = await prisma.article.findFirst({
      where: { id: articleId, groupId },
      select: { id: true },
    });
    if (!article) throw new Error("That article is not in this issue");
  }

  await updateSlotInGroup(slotId, groupId, { articleId: articleId || null });

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
  await requireGroupMutable(groupId, session);

  // Media must already live in our S3 bucket (presigned PUT via POST /api/upload).
  // This is what keeps whole-file `data:` URLs out of the column.
  const media = parseOrThrow(
    slotMediaSchema,
    { mediaUrl, mediaType, mediaAlt, mediaCredit },
    "media",
  );

  await updateSlotInGroup(slotId, groupId, media);

  revalidatePath(`/dashboard/groups/${groupId}`);
  revalidatePath("/");
  invalidateHomepage();
}

export async function clearBlockSlot(slotId: string, groupId: string) {
  const session = await auth();
  requireDashboardRole(session);
  await requireGroupMutable(groupId, session);

  await updateSlotInGroup(slotId, groupId, {
    articleId: null,
    mediaUrl: null,
    mediaType: null,
    mediaAlt: null,
    mediaCredit: null,
  });

  revalidatePath(`/dashboard/groups/${groupId}`);
  revalidatePath(`/dashboard/groups/${groupId}/layout`);
  revalidatePath("/");
  invalidateHomepage();
}

export async function clearSlotArticle(slotId: string, groupId: string) {
  const session = await auth();
  requireDashboardRole(session);
  await requireGroupMutable(groupId, session);

  await updateSlotInGroup(slotId, groupId, { articleId: null });

  revalidatePath(`/dashboard/groups/${groupId}`);
  revalidatePath(`/dashboard/groups/${groupId}/layout`);
  revalidatePath("/");
  invalidateHomepage();
}

export async function updateSlotScale(slotId: string, scale: string, groupId: string) {
  const session = await auth();
  requireDashboardRole(session);
  await requireGroupMutable(groupId, session);

  await updateSlotInGroup(slotId, groupId, {
    scale: parseOrThrow(slotScaleSchema, scale, "scale"),
  });

  revalidatePath(`/dashboard/groups/${groupId}`);
  revalidatePath(`/dashboard/groups/${groupId}/layout`);
  revalidatePath("/");
  invalidateHomepage();
}

export async function updateSlotImageScale(slotId: string, imageScale: string, groupId: string) {
  const session = await auth();
  requireDashboardRole(session);
  await requireGroupMutable(groupId, session);

  await updateSlotInGroup(slotId, groupId, {
    imageScale: parseOrThrow(slotScaleSchema, imageScale, "scale"),
  });

  revalidatePath(`/dashboard/groups/${groupId}`);
  revalidatePath(`/dashboard/groups/${groupId}/layout`);
  revalidatePath("/");
  invalidateHomepage();
}

export async function updateSlotPreviewLength(slotId: string, length: number, groupId: string) {
  const session = await auth();
  requireDashboardRole(session);
  await requireGroupMutable(groupId, session);

  const clamped = Math.max(50, Math.min(500, Math.round(Number(length) || 0)));
  await updateSlotInGroup(slotId, groupId, { previewLength: clamped });

  revalidatePath("/");
  invalidateHomepage();
}

export async function toggleSlotFeatured(slotId: string, featured: boolean, groupId: string) {
  const session = await auth();
  requireDashboardRole(session);
  await requireGroupMutable(groupId, session);

  await updateSlotInGroup(slotId, groupId, { featured: Boolean(featured) });

  revalidatePath(`/dashboard/groups/${groupId}/layout`);
  revalidatePath("/");
  invalidateHomepage();
}

export async function toggleSlotByline(slotId: string, showByline: boolean, groupId: string) {
  const session = await auth();
  requireDashboardRole(session);
  await requireGroupMutable(groupId, session);

  await updateSlotInGroup(slotId, groupId, { showByline: Boolean(showByline) });

  revalidatePath(`/dashboard/groups/${groupId}/layout`);
  revalidatePath("/");
  invalidateHomepage();
}

export async function updateImageFloat(slotId: string, imageFloat: string, groupId: string) {
  const session = await auth();
  requireDashboardRole(session);
  await requireGroupMutable(groupId, session);

  await updateSlotInGroup(slotId, groupId, {
    imageFloat: parseOrThrow(imageFloatSchema, imageFloat, "image float"),
  });

  revalidatePath(`/dashboard/groups/${groupId}`);
  revalidatePath(`/dashboard/groups/${groupId}/layout`);
  revalidatePath("/");
  invalidateHomepage();
}

export async function updateImageWidth(slotId: string, imageWidth: number, groupId: string) {
  const session = await auth();
  requireDashboardRole(session);
  await requireGroupMutable(groupId, session);

  const clamped = Math.max(10, Math.min(100, Math.round(Number(imageWidth) || 0)));
  await updateSlotInGroup(slotId, groupId, { imageWidth: clamped });

  revalidatePath(`/dashboard/groups/${groupId}`);
  revalidatePath(`/dashboard/groups/${groupId}/layout`);
  revalidatePath("/");
  invalidateHomepage();
}

export async function updateImageCrop(slotId: string, imageCrop: string, imageCropCustom: string | null, groupId: string) {
  const session = await auth();
  requireDashboardRole(session);
  await requireGroupMutable(groupId, session);

  const crop = parseOrThrow(imageCropSchema, imageCrop, "image crop");
  const custom = parseOrThrow(imageCropCustomSchema, imageCropCustom ?? null, "crop ratio");

  await updateSlotInGroup(slotId, groupId, {
    imageCrop: crop,
    imageCropCustom: crop === "custom" ? custom : null,
  });

  revalidatePath(`/dashboard/groups/${groupId}`);
  revalidatePath(`/dashboard/groups/${groupId}/layout`);
  revalidatePath("/");
  invalidateHomepage();
}

export async function updateMediaCredit(slotId: string, mediaCredit: string, groupId: string) {
  const session = await auth();
  requireDashboardRole(session);
  await requireGroupMutable(groupId, session);

  await updateSlotInGroup(slotId, groupId, {
    mediaCredit: parseOrThrow(mediaCreditSchema, mediaCredit, "media credit"),
  });

  revalidatePath(`/dashboard/groups/${groupId}`);
  revalidatePath(`/dashboard/groups/${groupId}/layout`);
  revalidatePath("/");
  invalidateHomepage();
}

export async function clearSlotMedia(slotId: string, groupId: string) {
  const session = await auth();
  requireDashboardRole(session);
  await requireGroupMutable(groupId, session);

  await updateSlotInGroup(slotId, groupId, {
    mediaUrl: null,
    mediaType: null,
    mediaAlt: null,
    mediaCredit: null,
  });

  revalidatePath(`/dashboard/groups/${groupId}`);
  revalidatePath(`/dashboard/groups/${groupId}/layout`);
  revalidatePath("/");
  invalidateHomepage();
}
