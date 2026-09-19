import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkAdmin } from "@/lib/middleware/auth";
import { errorResponse } from "@/lib/errors";
import { userPublicWithEmailSelect } from "@/lib/prisma-selects";

export async function GET(req: NextRequest) {
  const { error } = await checkAdmin();
  if (error) return error;

  const params = Object.fromEntries(req.nextUrl.searchParams);
  const page = Math.max(1, parseInt(params.page || "1"));
  const limit = Math.min(100, Math.max(1, parseInt(params.limit || "20")));

  const [data, total] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        ...userPublicWithEmailSelect,
        isAdmin: true,
        createdAt: true,
      },
    }),
    prisma.user.count(),
  ]);

  return NextResponse.json({
    data,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}
