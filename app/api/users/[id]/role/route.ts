import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { userPublicWithEmailSelect } from "@/lib/prisma-selects";
import { checkAdmin } from "@/lib/middleware/auth";
import { updateRoleSchema } from "@/lib/validations";
import { errorResponse } from "@/lib/errors";
import { canAssignRole } from "@/lib/roles";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { session, error } = await checkAdmin();
  if (error) return error;

  // Mirror the self-id guard in admin-actions.ts:
  // a sole admin demoting themselves locks everyone out of the admin panel.
  if (session.user.id === id) {
    return errorResponse("BAD_REQUEST", "You cannot change your own role");
  }

  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) {
    return errorResponse("NOT_FOUND", "User not found", 404);
  }

  const body = await req.json();
  const parsed = updateRoleSchema.safeParse(body);

  if (!parsed.success) {
    return errorResponse("BAD_REQUEST", parsed.error.issues[0].message);
  }

  // Caller must outrank both the target's current role and the new role unless they are
  // WEB_MASTER — so WEB_TEAM can neither grant nor remove WEB_TEAM / WEB_MASTER.
  if (!canAssignRole(session.user.role, existing.role, parsed.data.role)) {
    return errorResponse("FORBIDDEN", "Only a web master can assign or remove admin roles", 403);
  }

  const user = await prisma.user.update({
    where: { id },
    data: { role: parsed.data.role },
    select: { ...userPublicWithEmailSelect, isAdmin: true },
  }) as unknown as { id: string; email: string | null; name: string | null; image: string | null; role: string; displayTitle: string | null; isAdmin: boolean };

  return NextResponse.json({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    isAdmin: user.isAdmin,
  });
}
