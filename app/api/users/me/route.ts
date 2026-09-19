import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkAuth } from "@/lib/middleware/auth";
import { errorResponse } from "@/lib/errors";
import { userPublicWithEmailSelect } from "@/lib/prisma-selects";

export async function GET(req: NextRequest) {
  const { session, error } = await checkAuth();
  if (error) return error;

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      ...userPublicWithEmailSelect,
      isAdmin: true,
      createdAt: true,
    },
  });

  if (!user) {
    return errorResponse("NOT_FOUND", "User not found", 404);
  }

  return NextResponse.json(user);
}
