import { auth } from "@/lib/auth";
import { errorResponse } from "@/lib/errors";
import { Role } from "@prisma/client";
import { ROLE_LEVEL } from "@/lib/roles";
import { Session } from "next-auth";

type AuthResult =
  | { session: Session; error: undefined }
  | { session: null; error: Response };

export async function checkRole(requiredRole: Role): Promise<AuthResult> {
  const session = await auth();

  if (!session?.user) {
    return {
      session: null,
      error: errorResponse("UNAUTHORIZED", "You must be signed in", 401),
    };
  }

  const userLevel = ROLE_LEVEL[session.user.role];
  const requiredLevel = ROLE_LEVEL[requiredRole];

  if (!session.user.isAdmin && userLevel < requiredLevel) {
    return {
      session: null,
      error: errorResponse(
        "FORBIDDEN",
        `You must be an ${requiredRole.toLowerCase()} to perform this action`,
        403
      ),
    };
  }

  return { session, error: undefined };
}

export async function checkAdmin(): Promise<AuthResult> {
  const session = await auth();

  if (!session?.user) {
    return {
      session: null,
      error: errorResponse("UNAUTHORIZED", "You must be signed in", 401),
    };
  }

  if (!session.user.isAdmin) {
    return {
      session: null,
      error: errorResponse("FORBIDDEN", "Admin access required", 403),
    };
  }

  return { session, error: undefined };
}

export async function checkAuth(): Promise<AuthResult> {
  const session = await auth();

  if (!session?.user) {
    return {
      session: null,
      error: errorResponse("UNAUTHORIZED", "You must be signed in", 401),
    };
  }

  return { session, error: undefined };
}
