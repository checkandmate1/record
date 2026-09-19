"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";
import { ALL_ROLES, isAdminRole, canAssignRole } from "@/lib/roles";

// Admin panel actions are WEB_TEAM+ (the same gate as app/admin/layout.tsx and proxy.ts).
async function requireAdmin() {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  if (!isAdminRole(session.user.role)) {
    throw new Error("Forbidden");
  }
  return session;
}

export async function updateUserRole(userId: string, formData: FormData) {
  const session = await requireAdmin();

  if (session.user.id === userId) {
    throw new Error("You cannot change your own role");
  }

  const role = formData.get("role") as string;
  if (!(ALL_ROLES as readonly string[]).includes(role)) {
    throw new Error("Invalid role");
  }

  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  if (!existing) throw new Error("User not found");

  // Caller must outrank both the target's current role and the new role unless they are
  // WEB_MASTER — so WEB_TEAM can neither grant nor remove WEB_TEAM / WEB_MASTER.
  if (!canAssignRole(session.user.role, existing.role, role as Role)) {
    throw new Error("Only a web master can assign or remove admin roles");
  }

  await prisma.user.update({
    where: { id: userId },
    data: { role: role as Role },
  });

  revalidatePath(`/admin/users/${userId}`);
  revalidatePath("/admin/users");
  redirect(`/admin/users/${userId}?saved=1`);
}

export async function updateUserDisplayTitle(userId: string, formData: FormData) {
  await requireAdmin();

  const raw = (formData.get("displayTitle") as string | null)?.trim() ?? "";
  const displayTitle = raw.length === 0 ? null : raw;

  await prisma.user.update({
    where: { id: userId },
    data: { displayTitle },
  });

  revalidatePath(`/admin/users/${userId}`);
  redirect(`/admin/users/${userId}?saved=1`);
}

export async function updateUserPriority(userId: string, formData: FormData) {
  await requireAdmin();

  const raw = ((formData.get("priority") as string | null) ?? "").trim();
  const n = parseInt(raw, 10);
  const priority = Number.isFinite(n) ? n : 0;

  await prisma.user.update({
    where: { id: userId },
    data: { priority },
  });

  revalidatePath(`/admin/users/${userId}`);
  revalidatePath("/about");
  redirect(`/admin/users/${userId}?saved=1`);
}

