import type { Role } from "@prisma/client";

// The single source of truth for role lists and role labels. Every page, server action,
// route handler and proxy.ts imports from here — never re-declare an inline array.
//
// `Role` is imported as a type only so this module is safe to import from client
// components (no Prisma runtime in the browser bundle). The `_exhaustive` check below
// makes `tsc` fail if a Role enum member is added to the schema but not listed here.

export const ALL_ROLES = [
  "READER",
  "WRITER",
  "DESIGNER",
  "PHOTOGRAPHER",
  "ART_TEAM",
  "EDITOR",
  "CHIEF_EDITOR",
  "WEB_TEAM",
  "WEB_MASTER",
] as const satisfies readonly Role[];

type ListedRole = (typeof ALL_ROLES)[number];
const _exhaustive: [Exclude<Role, ListedRole>] extends [never] ? true : never = true;
void _exhaustive;

/** READER 0 … WEB_MASTER 8, strictly increasing in enum order. */
export const ROLE_LEVEL: Record<Role, number> = Object.fromEntries(
  ALL_ROLES.map((r, i) => [r, i])
) as Record<Role, number>;

/** Everything except READER: can open /dashboard and use the editorial tools. */
export const DASHBOARD_ROLES: readonly Role[] = ALL_ROLES.filter((r) => r !== "READER");

/** EDITOR and above: create/publish issues, edit anyone's work, remove others' approvals. */
export const EDITOR_ROLES: readonly Role[] = ["EDITOR", "CHIEF_EDITOR", "WEB_TEAM", "WEB_MASTER"];

/** WEB_TEAM and WEB_MASTER: the admin panel (users, authors, directory search). */
export const ADMIN_ROLES: readonly Role[] = ["WEB_TEAM", "WEB_MASTER"];

/** Human-readable label for each role, used wherever a byline or profile falls back from `displayTitle`. */
export const ROLE_DISPLAY: Record<Role, string> = {
  READER: "Reader",
  WRITER: "Staff Writer",
  DESIGNER: "Designer",
  PHOTOGRAPHER: "Photographer",
  ART_TEAM: "Art Team",
  EDITOR: "Editor",
  CHIEF_EDITOR: "Chief Editor",
  WEB_TEAM: "Web Team",
  WEB_MASTER: "Web Master",
};

/** Label for a role string that may come from an untyped source (session, API). Falls back to the raw value. */
export function roleLabel(role: string | null | undefined): string {
  if (!role) return "";
  return (ROLE_DISPLAY as Record<string, string>)[role] ?? role;
}

export function isDashboardRole(role: string | null | undefined): boolean {
  return !!role && (DASHBOARD_ROLES as readonly string[]).includes(role);
}

export function isEditorRole(role: string | null | undefined): boolean {
  return !!role && (EDITOR_ROLES as readonly string[]).includes(role);
}

export function isAdminRole(role: string | null | undefined): boolean {
  return !!role && (ADMIN_ROLES as readonly string[]).includes(role);
}

/**
 * May `caller` change a user's role from `targetCurrent` to `targetNew`?
 *
 * - Caller must be an admin role.
 * - WEB_MASTER may assign anything.
 * - WEB_TEAM may neither grant nor remove WEB_TEAM / WEB_MASTER: the caller must outrank
 *   both the target's current role and the new role.
 */
export function canAssignRole(caller: Role, targetCurrent: Role, targetNew: Role): boolean {
  if (!isAdminRole(caller)) return false;
  if (caller === "WEB_MASTER") return true;
  const callerLevel = ROLE_LEVEL[caller];
  return callerLevel > Math.max(ROLE_LEVEL[targetCurrent], ROLE_LEVEL[targetNew]);
}
