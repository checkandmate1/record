"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getDirectoryUserByEmail } from "@/lib/google-directory";
import { revalidatePath } from "next/cache";
import { randomUUID } from "crypto";
import { isAdminRole } from "@/lib/roles";
import { userMinimalNameSelect } from "@/lib/prisma-selects";

// Creating authors is a WEB_TEAM+ (admin-panel) action. Writers can still credit existing
// placeholder authors via the article credit picker; they just can't mint new ones.
function requireWebTeam(session: { user?: { role?: string } } | null) {
  if (!isAdminRole(session?.user?.role)) {
    throw new Error("Web team access required");
  }
}

export type AddAuthorResult = { id: string; name: string };

// Look up an @horacemann.org account in the Workspace directory and ensure a User row exists for
// it. Returns the existing user if one already matches the email (real or placeholder) — never
// duplicates. New rows are created as unclaimed placeholders (READER, no Account).
export async function addDirectoryAuthor(email: string): Promise<AddAuthorResult> {
  const session = await auth();
  requireWebTeam(session);

  const normalized = email.trim().toLowerCase();
  if (!normalized.endsWith("@horacemann.org")) {
    throw new Error("Only @horacemann.org accounts can be added");
  }

  // Dedup: the email is deterministically encrypted, so this where-clause resolves via the
  // emailHash blind index inside the Prisma extension.
  const existing = await prisma.user.findUnique({
    where: { email: normalized },
    select: userMinimalNameSelect,
  });
  if (existing) {
    return { id: existing.id, name: existing.name ?? normalized };
  }

  const person = await getDirectoryUserByEmail(normalized);
  if (!person) {
    throw new Error("No matching directory account found");
  }

  const created = await prisma.user.create({
    data: {
      email: person.email.toLowerCase(),
      name: person.name,
      image: person.photoUrl,
      role: "READER",
      isPlaceholder: true,
    } as never,
    select: userMinimalNameSelect,
  });

  revalidatePath("/admin/authors");
  return { id: created.id, name: created.name ?? person.name };
}

// Manually add an author: name required, email + photo optional. (Policy — not enforced here —
// is that this is for HM people only.) When no email is given we synthesize a unique, non-routable
// `.invalid` address (RFC 2606) so the required encrypted email columns (emailCiphertext / unique
// emailHash) are satisfied; such an author can never be claimed on login (no real Google account
// matches), which is the intended "may never claim" case. A blank photo stays null — the byline
// falls back to the initial-letter avatar.
export async function addManualAuthor(input: {
  name: string;
  email?: string;
  photoUrl?: string;
}): Promise<AddAuthorResult> {
  const session = await auth();
  requireWebTeam(session);

  const name = input.name.trim();
  if (!name) throw new Error("Name is required");

  const email = input.email?.trim().toLowerCase() || "";
  const photoUrl = input.photoUrl?.trim() || null;

  if (email) {
    // Dedup against an existing user (real or placeholder) when an email is provided.
    const existing = await prisma.user.findUnique({
      where: { email },
      select: userMinimalNameSelect,
    });
    if (existing) return { id: existing.id, name: existing.name ?? name };
  }

  const finalEmail = email || `manual-${randomUUID()}@manual.invalid`;

  const created = await prisma.user.create({
    data: {
      email: finalEmail,
      name,
      image: photoUrl,
      role: "READER",
      isPlaceholder: true,
    } as never,
    select: userMinimalNameSelect,
  });

  revalidatePath("/admin/authors");
  return { id: created.id, name: created.name ?? name };
}

// Remove an unclaimed placeholder author. Refuses if the row was claimed (has logged in) or has
// any attribution (authored articles or credits) so we never orphan real authorship.
export async function removeDirectoryAuthor(id: string): Promise<void> {
  const session = await auth();
  requireWebTeam(session);

  // Check + delete in one interactive transaction so a concurrent article edit can't add a credit
  // between the guard and the delete (which would orphan attribution). None of these fields are
  // encrypted, so the transaction client needs no extension behavior.
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id },
      select: {
        isPlaceholder: true,
        _count: { select: { articles: true, articleCredits: true } },
      },
    });
    if (!user) throw new Error("Author not found");
    if (!user.isPlaceholder) throw new Error("This author has logged in and cannot be removed here");
    if (user._count.articles > 0 || user._count.articleCredits > 0) {
      throw new Error("This author is credited on articles; remove those credits first");
    }
    await tx.user.delete({ where: { id } });
  });

  revalidatePath("/admin/authors");
}
