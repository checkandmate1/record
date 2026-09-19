import { PATCH as updateRole } from "@/app/api/users/[id]/role/route";
import { NextRequest } from "next/server";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: jest.fn(), update: jest.fn() },
  },
}));

jest.mock("@/lib/middleware/auth", () => ({
  checkAdmin: jest.fn(),
}));

import { prisma } from "@/lib/prisma";
import { checkAdmin } from "@/lib/middleware/auth";

const mockFindUnique = prisma.user.findUnique as jest.Mock;
const mockUpdate = prisma.user.update as jest.Mock;
const mockCheckAdmin = checkAdmin as jest.Mock;

const adminSession = {
  session: { user: { id: "admin-1", role: "WEB_MASTER", isAdmin: true } },
  error: undefined,
};

const webTeamSession = {
  session: { user: { id: "webteam-1", role: "WEB_TEAM", isAdmin: true } },
  error: undefined,
};

function roleRequest(id: string, role: string) {
  return new NextRequest(`http://localhost/api/users/${id}/role`, {
    method: "PATCH",
    body: JSON.stringify({ role }),
    headers: { "Content-Type": "application/json" },
  });
}

describe("PATCH /api/users/[id]/role", () => {
  beforeEach(() => jest.clearAllMocks());

  it("updates user role", async () => {
    mockCheckAdmin.mockResolvedValue(adminSession);
    mockFindUnique.mockResolvedValue({ id: "user-1", role: "READER" });
    mockUpdate.mockResolvedValue({ id: "user-1", role: "EDITOR" });

    const res = await updateRole(roleRequest("user-1", "EDITOR"), {
      params: Promise.resolve({ id: "user-1" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.role).toBe("EDITOR");
  });

  it("accepts the newer roles (PHOTOGRAPHER, ART_TEAM, CHIEF_EDITOR)", async () => {
    mockCheckAdmin.mockResolvedValue(adminSession);
    mockFindUnique.mockResolvedValue({ id: "user-1", role: "READER" });
    mockUpdate.mockResolvedValue({ id: "user-1", role: "CHIEF_EDITOR" });

    const res = await updateRole(roleRequest("user-1", "CHIEF_EDITOR"), {
      params: Promise.resolve({ id: "user-1" }),
    });

    expect(res.status).toBe(200);
  });

  it("prevents admin from changing their own role", async () => {
    mockCheckAdmin.mockResolvedValue(adminSession);

    const res = await updateRole(roleRequest("admin-1", "READER"), {
      params: Promise.resolve({ id: "admin-1" }),
    });

    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns 403 when WEB_TEAM tries to grant WEB_MASTER", async () => {
    mockCheckAdmin.mockResolvedValue(webTeamSession);
    mockFindUnique.mockResolvedValue({ id: "user-1", role: "EDITOR" });

    const res = await updateRole(roleRequest("user-1", "WEB_MASTER"), {
      params: Promise.resolve({ id: "user-1" }),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns 403 when WEB_TEAM tries to demote a WEB_MASTER", async () => {
    mockCheckAdmin.mockResolvedValue(webTeamSession);
    mockFindUnique.mockResolvedValue({ id: "user-1", role: "WEB_MASTER" });

    const res = await updateRole(roleRequest("user-1", "READER"), {
      params: Promise.resolve({ id: "user-1" }),
    });

    expect(res.status).toBe(403);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("lets WEB_TEAM move a non-admin user between non-admin roles", async () => {
    mockCheckAdmin.mockResolvedValue(webTeamSession);
    mockFindUnique.mockResolvedValue({ id: "user-1", role: "READER" });
    mockUpdate.mockResolvedValue({ id: "user-1", role: "EDITOR" });

    const res = await updateRole(roleRequest("user-1", "EDITOR"), {
      params: Promise.resolve({ id: "user-1" }),
    });

    expect(res.status).toBe(200);
  });
});
