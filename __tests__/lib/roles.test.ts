import { Role } from "@prisma/client";
import {
  ALL_ROLES,
  DASHBOARD_ROLES,
  EDITOR_ROLES,
  ADMIN_ROLES,
  ROLE_LEVEL,
  isDashboardRole,
  isEditorRole,
  isAdminRole,
  canAssignRole,
} from "@/lib/roles";

const ENUM_ROLES = Object.values(Role) as Role[];

describe("role lists", () => {
  it("ALL_ROLES contains every Role enum member exactly once", () => {
    expect([...ALL_ROLES].sort()).toEqual([...ENUM_ROLES].sort());
    expect(new Set(ALL_ROLES).size).toBe(ALL_ROLES.length);
  });

  it("ROLE_LEVEL has an entry for every Role and is strictly increasing in ALL_ROLES order", () => {
    for (const r of ENUM_ROLES) {
      expect(typeof ROLE_LEVEL[r]).toBe("number");
    }
    for (let i = 1; i < ALL_ROLES.length; i++) {
      expect(ROLE_LEVEL[ALL_ROLES[i]]).toBeGreaterThan(ROLE_LEVEL[ALL_ROLES[i - 1]]);
    }
    expect(ROLE_LEVEL.READER).toBe(0);
    expect(ROLE_LEVEL.WEB_MASTER).toBe(8);
  });

  it("DASHBOARD_ROLES is every role except READER", () => {
    expect([...DASHBOARD_ROLES].sort()).toEqual(
      ENUM_ROLES.filter((r) => r !== "READER").sort()
    );
  });

  it("EDITOR_ROLES is a subset of DASHBOARD_ROLES and ADMIN_ROLES a subset of EDITOR_ROLES", () => {
    for (const r of EDITOR_ROLES) expect(DASHBOARD_ROLES).toContain(r);
    for (const r of ADMIN_ROLES) expect(EDITOR_ROLES).toContain(r);
    expect([...EDITOR_ROLES]).toEqual(["EDITOR", "CHIEF_EDITOR", "WEB_TEAM", "WEB_MASTER"]);
    expect([...ADMIN_ROLES]).toEqual(["WEB_TEAM", "WEB_MASTER"]);
  });

  it("predicates agree with the lists", () => {
    for (const r of ENUM_ROLES) {
      expect(isDashboardRole(r)).toBe(DASHBOARD_ROLES.includes(r));
      expect(isEditorRole(r)).toBe(EDITOR_ROLES.includes(r));
      expect(isAdminRole(r)).toBe(ADMIN_ROLES.includes(r));
    }
    expect(isDashboardRole("PHOTOGRAPHER")).toBe(true);
    expect(isDashboardRole("ART_TEAM")).toBe(true);
    expect(isEditorRole("CHIEF_EDITOR")).toBe(true);
    expect(isEditorRole("PHOTOGRAPHER")).toBe(false);
    expect(isAdminRole("CHIEF_EDITOR")).toBe(false);
  });
});

describe("canAssignRole", () => {
  it("WEB_TEAM cannot grant WEB_MASTER", () => {
    expect(canAssignRole("WEB_TEAM", "READER", "WEB_MASTER")).toBe(false);
    expect(canAssignRole("WEB_TEAM", "EDITOR", "WEB_MASTER")).toBe(false);
  });

  it("WEB_TEAM cannot grant WEB_TEAM", () => {
    expect(canAssignRole("WEB_TEAM", "READER", "WEB_TEAM")).toBe(false);
  });

  it("WEB_TEAM cannot demote a WEB_MASTER or another WEB_TEAM", () => {
    expect(canAssignRole("WEB_TEAM", "WEB_MASTER", "READER")).toBe(false);
    expect(canAssignRole("WEB_TEAM", "WEB_MASTER", "EDITOR")).toBe(false);
    expect(canAssignRole("WEB_TEAM", "WEB_TEAM", "READER")).toBe(false);
  });

  it("WEB_TEAM can move non-admin users between non-admin roles", () => {
    expect(canAssignRole("WEB_TEAM", "READER", "EDITOR")).toBe(true);
    expect(canAssignRole("WEB_TEAM", "CHIEF_EDITOR", "READER")).toBe(true);
    expect(canAssignRole("WEB_TEAM", "WRITER", "PHOTOGRAPHER")).toBe(true);
  });

  it("WEB_MASTER can assign anything", () => {
    for (const from of ENUM_ROLES) {
      for (const to of ENUM_ROLES) {
        expect(canAssignRole("WEB_MASTER", from, to)).toBe(true);
      }
    }
  });

  it("non-admin callers can never assign a role", () => {
    for (const caller of ENUM_ROLES.filter((r) => !ADMIN_ROLES.includes(r))) {
      for (const from of ENUM_ROLES) {
        for (const to of ENUM_ROLES) {
          expect(canAssignRole(caller, from, to)).toBe(false);
        }
      }
    }
  });
});
