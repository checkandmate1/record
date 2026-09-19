import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { errorResponse } from "@/lib/errors";
import { userPublicSelect } from "@/lib/prisma-selects";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      ...userPublicSelect,
      createdAt: true,
      articleCredits: {
        where: { article: { group: { status: "PUBLISHED" } } },
        include: {
          article: {
            select: {
              id: true,
              title: true,
              slug: true,
              section: true,
              group: { select: { publishedAt: true } },
            },
          },
        },
        orderBy: { article: { group: { publishedAt: "desc" } } },
      },
    },
  });

  if (!user) {
    return errorResponse("NOT_FOUND", "User not found", 404);
  }

  return NextResponse.json(user);
}
