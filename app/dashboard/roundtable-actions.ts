"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sanitizeHtml } from "@/lib/sanitize";
import { generateUniqueRoundTableSlug } from "@/lib/slugify";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { invalidateHomepage } from "@/lib/page-cache";
import { isDashboardRole, isEditorRole } from "@/lib/roles";
import {
  roundTableActionSchema,
  MAX_ROUND_TABLE_TURNS,
  ROUND_TABLE_SIDES,
  type RoundTableActionInput,
} from "@/lib/validations";

// Interactive transactions default to a 5 s timeout. Every side/turn write costs a KMS
// GenerateDataKey round trip (lib/CLAUDE.md), so 100 turns needs a lot more headroom.
const TX_TIMEOUT_MS = 20_000;

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

  // A published issue is live on the homepage; only EDITOR+ may change what readers see.
  if (group.status === "PUBLISHED" && !isEditorRole(session?.user?.role)) {
    throw new Error("Only editors can add a round table to a published issue");
  }

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

  revalidatePath(`/dashboard/groups/${groupId}`);
  revalidatePath("/roundtable");
  revalidatePath("/");
  invalidateHomepage();
  redirect(`/dashboard/roundtables/${rt.id}/edit`);
}

const SIDE_FIELD_RE = /^side_(\d+)_(id|label|authors)$/;
const TURN_BODY_RE = /^turn_(\d+)_body$/;

/**
 * Walk the submitted FormData for `side_<i>_*` / `turn_<i>_body` entries.
 *
 * The previous implementation trusted `side_count` / `turn_count` fields, so a forged
 * `turn_count=10000000` turned one POST into ten million map lookups. Iterating the real entries
 * bounds the work at the request body; the explicit caps bound it again and let Zod produce a
 * clean error instead of silently truncating.
 */
function parseSidesAndTurns(formData: FormData): {
  sides: { id: string | null; label: string; authorIds: string[] }[];
  turns: { body: string }[];
} {
  const sideFields = new Map<number, { id?: string; label?: string; authors?: string }>();
  const turnBodies = new Map<number, string>();

  for (const [key, value] of formData.entries()) {
    if (typeof value !== "string") continue;

    const sideMatch = SIDE_FIELD_RE.exec(key);
    if (sideMatch) {
      const index = Number(sideMatch[1]);
      // Allow one past the cap so the schema rejects rather than silently dropping a side.
      if (!sideFields.has(index) && sideFields.size > ROUND_TABLE_SIDES) continue;
      const entry = sideFields.get(index) ?? {};
      entry[sideMatch[2] as "id" | "label" | "authors"] = value;
      sideFields.set(index, entry);
      continue;
    }

    const turnMatch = TURN_BODY_RE.exec(key);
    if (turnMatch && turnBodies.size <= MAX_ROUND_TABLE_TURNS) {
      turnBodies.set(Number(turnMatch[1]), value);
    }
  }

  const sides = [...sideFields.keys()]
    .sort((a, b) => a - b)
    .map((index, position) => {
      const entry = sideFields.get(index)!;
      const authors = entry.authors ?? "";
      return {
        id: entry.id ? entry.id : null,
        label: (entry.label ?? "").trim() || `Side ${position + 1}`,
        authorIds: authors
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      };
    });

  const turns = [...turnBodies.keys()]
    .sort((a, b) => a - b)
    .map((index) => ({ body: turnBodies.get(index)!.trim() }))
    .filter((t) => t.body.length > 0);

  return { sides, turns };
}

function parseRoundTableForm(formData: FormData): RoundTableActionInput {
  const prompt = ((formData.get("prompt") as string) ?? "").trim();
  if (!prompt) throw new Error("Prompt is required");

  const { sides, turns } = parseSidesAndTurns(formData);

  const parsed = roundTableActionSchema.safeParse({ prompt, sides, turns });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid round table");
  }
  return parsed.data;
}

export async function updateRoundTable(id: string, formData: FormData) {
  const session = await auth();
  requireDashboardRole(session);

  // No top-level `select`: RoundTable.prompt is envelope-encrypted and we need the decrypted
  // value to know whether the slug must be regenerated (lib/CLAUDE.md).
  const existing = await prisma.roundTable.findUnique({
    where: { id },
    include: { group: { select: { status: true } } },
  });
  if (!existing) throw new Error("Round table not found");

  // Once an issue is published the round table is live; editing it is an EDITOR+ act.
  if (!isEditorRole(session?.user?.role) && existing.group?.status === "PUBLISHED") {
    throw new Error("Only editors can edit published round tables");
  }

  const data = parseRoundTableForm(formData);
  const sides = data.sides.map((s) => ({ ...s, authorIds: [...s.authorIds] }));

  // A user can't be on both sides — keep them on side 0 if duplicated.
  const sideAIds = new Set(sides[0].authorIds);
  sides[1].authorIds = sides[1].authorIds.filter((uid) => !sideAIds.has(uid));

  // The slug is derived from the prompt; it used to be minted once at creation and never
  // updated, so every round table kept the "untitled-round-table" URL forever.
  const promptChanged = (existing.prompt ?? "") !== data.prompt;
  const slug = promptChanged ? await generateUniqueRoundTableSlug(data.prompt) : undefined;

  // Sides and turns are "delete all, recreate". Without a transaction a failure part-way left
  // the round table with no turns (or turns pointing at a half-updated set of sides).
  await prisma.$transaction(
    async (tx) => {
      await tx.roundTable.update({
        where: { id },
        data: slug ? { prompt: data.prompt, slug } : { prompt: data.prompt },
      });

      // Update sides: keep stable IDs, update label, replace authors
      const existingSides = await tx.roundTableSide.findMany({
        where: { roundTableId: id },
        orderBy: { order: "asc" },
      });

      const sideIdByIndex: string[] = [];
      for (let i = 0; i < sides.length; i++) {
        const existingSide = existingSides[i];
        const payload = sides[i];
        if (existingSide) {
          await tx.roundTableSide.update({
            where: { id: existingSide.id },
            data: { label: payload.label, order: i },
          });
          sideIdByIndex.push(existingSide.id);
        } else {
          const created = await tx.roundTableSide.create({
            data: { roundTableId: id, label: payload.label, order: i } as never,
          });
          sideIdByIndex.push(created.id);
        }
        await tx.roundTableSideAuthor.deleteMany({ where: { sideId: sideIdByIndex[i] } });
        if (payload.authorIds.length > 0) {
          await tx.roundTableSideAuthor.createMany({
            data: payload.authorIds.map((userId) => ({
              sideId: sideIdByIndex[i],
              userId,
            })),
            skipDuplicates: true,
          });
        }
      }

      // Replace all turns. Strict alternation: side 0 first, then 1, 0, 1...
      await tx.roundTableTurn.deleteMany({ where: { roundTableId: id } });
      if (data.turns.length > 0) {
        await tx.roundTableTurn.createMany({
          data: data.turns.map((t, idx) => ({
            roundTableId: id,
            sideId: sideIdByIndex[idx % 2]!,
            body: sanitizeHtml(t.body),
            order: idx,
          })) as never,
        });
      }
    },
    { timeout: TX_TIMEOUT_MS },
  );

  revalidatePath(`/dashboard/roundtables/${id}/edit`);
  revalidatePath(`/dashboard/groups/${existing.groupId}`);
  revalidatePath("/roundtable");
  revalidatePath("/");
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
  revalidatePath("/");
  invalidateHomepage();
  redirect(rt ? `/dashboard/groups/${rt.groupId}` : "/dashboard");
}
