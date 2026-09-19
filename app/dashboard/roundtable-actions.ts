"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sanitizeHtml } from "@/lib/sanitize";
import { generateUniqueRoundTableSlug } from "@/lib/slugify";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { invalidateHomepage } from "@/lib/page-cache";
import { isDashboardRole, isEditorRole } from "@/lib/roles";

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

export async function createRoundTable(groupId: string) {
  const session = await auth();
  requireDashboardRole(session);

  const group = await prisma.articleGroup.findUnique({ where: { id: groupId } });
  if (!group) throw new Error("Group not found");

  const existing = await prisma.roundTable.findUnique({ where: { groupId } });
  if (existing) {
    redirect(`/dashboard/roundtables/${existing.id}/edit`);
  }

  const placeholderPrompt = "Untitled Round Table";
  const slug = await generateUniqueRoundTableSlug(placeholderPrompt);

  // Cast around Phase 5 schema requiring ciphertext fields on top-level + nested creates —
  // extension populates them at runtime.
  const rt = await prisma.roundTable.create({
    data: {
      slug,
      prompt: placeholderPrompt,
      groupId,
      sides: {
        create: [
          { label: "Side A", order: 0 },
          { label: "Side B", order: 1 },
        ],
      },
    } as never,
  });

  redirect(`/dashboard/roundtables/${rt.id}/edit`);
}

interface SidePayload {
  id: string | null;
  label: string;
  authorIds: string[];
}

interface TurnPayload {
  body: string;
}

function parseSides(formData: FormData): SidePayload[] {
  const count = parseInt((formData.get("side_count") as string) ?? "0", 10) || 0;
  const sides: SidePayload[] = [];
  for (let i = 0; i < count; i++) {
    const id = (formData.get(`side_${i}_id`) as string) || null;
    const label = ((formData.get(`side_${i}_label`) as string) ?? "").trim() || `Side ${i + 1}`;
    const authorsStr = (formData.get(`side_${i}_authors`) as string) ?? "";
    const authorIds = authorsStr.split(",").map((s) => s.trim()).filter(Boolean);
    sides.push({ id, label, authorIds });
  }
  return sides;
}

function parseTurns(formData: FormData): TurnPayload[] {
  const count = parseInt((formData.get("turn_count") as string) ?? "0", 10) || 0;
  const turns: TurnPayload[] = [];
  for (let i = 0; i < count; i++) {
    const body = ((formData.get(`turn_${i}_body`) as string) ?? "").trim();
    if (body) turns.push({ body });
  }
  return turns;
}

export async function updateRoundTable(id: string, formData: FormData) {
  const session = await auth();
  requireDashboardRole(session);

  const prompt = ((formData.get("prompt") as string) ?? "").trim();
  if (!prompt) throw new Error("Prompt is required");

  const sides = parseSides(formData);
  const turns = parseTurns(formData);

  if (sides.length !== 2) {
    throw new Error("A round table must have exactly two sides");
  }

  // A user can't be on both sides — keep them on side 0 if duplicated.
  const sideAIds = new Set(sides[0].authorIds);
  sides[1].authorIds = sides[1].authorIds.filter((uid) => !sideAIds.has(uid));

  const existing = await prisma.roundTable.update({
    where: { id },
    data: { prompt },
    select: { groupId: true },
  });

  // Update sides: keep stable IDs, update label, replace authors
  const existingSides = await prisma.roundTableSide.findMany({
    where: { roundTableId: id },
    orderBy: { order: "asc" },
  });

  const sideIdByIndex: string[] = [];
  for (let i = 0; i < sides.length; i++) {
    const existingSide = existingSides[i];
    const payload = sides[i];
    if (existingSide) {
      await prisma.roundTableSide.update({
        where: { id: existingSide.id },
        data: { label: payload.label, order: i },
      });
      sideIdByIndex.push(existingSide.id);
    } else {
      const created = await prisma.roundTableSide.create({
        data: { roundTableId: id, label: payload.label, order: i } as never,
      });
      sideIdByIndex.push(created.id);
    }
    await prisma.roundTableSideAuthor.deleteMany({ where: { sideId: sideIdByIndex[i] } });
    if (payload.authorIds.length > 0) {
      await prisma.roundTableSideAuthor.createMany({
        data: payload.authorIds.map((userId) => ({
          sideId: sideIdByIndex[i],
          userId,
        })),
        skipDuplicates: true,
      });
    }
  }

  // Replace all turns. Strict alternation: side 0 first, then 1, 0, 1...
  await prisma.roundTableTurn.deleteMany({ where: { roundTableId: id } });
  if (turns.length > 0) {
    await prisma.roundTableTurn.createMany({
      data: turns.map((t, idx) => ({
        roundTableId: id,
        sideId: sideIdByIndex[idx % 2]!,
        body: sanitizeHtml(t.body),
        order: idx,
      })) as never,
    });
  }

  revalidatePath(`/dashboard/roundtables/${id}/edit`);
  revalidatePath(`/dashboard/groups/${existing.groupId}`);
  revalidatePath("/roundtable");
  invalidateHomepage();
  redirect(`/dashboard/roundtables/${id}/edit?saved=1`);
}

export async function deleteRoundTable(id: string) {
  const session = await auth();
  requireEditor(session);
  const rt = await prisma.roundTable.findUnique({
    where: { id },
    select: { groupId: true },
  });
  await prisma.roundTable.delete({ where: { id } });
  revalidatePath("/roundtable");
  if (rt) revalidatePath(`/dashboard/groups/${rt.groupId}`);
  invalidateHomepage();
  redirect(rt ? `/dashboard/groups/${rt.groupId}` : "/dashboard");
}
