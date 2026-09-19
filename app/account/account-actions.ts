"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { userPublicSelect } from "@/lib/prisma-selects";
import { profilePictureSchema } from "@/lib/validations";
import { revalidatePath } from "next/cache";

export async function updateProfilePicture(userId: string, imageDataUrl: string) {
  const session = await auth();
  if (!session?.user || session.user.id !== userId) {
    throw new Error("Not authorized");
  }

  // User.image is rendered straight into an <img src>, so the value has to be a real image —
  // not a `javascript:` URL or an arbitrary data: payload.
  const parsed = profilePictureSchema.safeParse(imageDataUrl);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid profile picture");
  }

  await prisma.user.update({
    where: { id: userId },
    data: { image: parsed.data },
  });

  revalidatePath("/account");
}

export async function resetProfilePicture(userId: string) {
  const session = await auth();
  if (!session?.user || session.user.id !== userId) {
    throw new Error("Not authorized");
  }

  // The Google photo is read from the row, never taken from the caller — the old signature let
  // a client pass any URL and have it stored as the user's picture.
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { ...userPublicSelect, googleImage: true },
  });
  if (!user) {
    throw new Error("User not found");
  }

  await prisma.user.update({
    where: { id: userId },
    data: { image: user.googleImage ?? null },
  });

  revalidatePath("/account");
}
