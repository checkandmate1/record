import { GET as listUsers } from "@/app/api/users/route";
import { GET as getMe } from "@/app/api/users/me/route";
import { GET as getUser } from "@/app/api/users/[id]/route";
import { NextRequest } from "next/server";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findMany: jest.fn(), count: jest.fn(), findUnique: jest.fn() },
  },
}));

jest.mock("@/lib/middleware/auth", () => ({
  checkAdmin: jest.fn(),
  checkAuth: jest.fn(),
}));

import { prisma } from "@/lib/prisma";
import { checkAdmin, checkAuth } from "@/lib/middleware/auth";

const mockFindMany = prisma.user.findMany as jest.Mock;
const mockCount = prisma.user.count as jest.Mock;
const mockFindUnique = prisma.user.findUnique as jest.Mock;
const mockCheckAdmin = checkAdmin as jest.Mock;
const mockCheckAuth = checkAuth as jest.Mock;

describe("GET /api/users", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns users for admins", async () => {
    mockCheckAdmin.mockResolvedValue({
      session: { user: { id: "1", isAdmin: true } },
      error: undefined,
    });
    mockFindMany.mockResolvedValue([{ id: "1", name: "Test" }]);
    mockCount.mockResolvedValue(1);

    const req = new NextRequest("http://localhost/api/users");
    const res = await listUsers(req);

    expect(res.status).toBe(200);
    // Envelope columns must be present or name/email/image silently decrypt to null.
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          id: true,
          encryptedDek: true,
          dekKekVersion: true,
          nameCiphertext: true,
          emailCiphertext: true,
        }),
      })
    );
  });

  it("rejects non-admins", async () => {
    mockCheckAdmin.mockResolvedValue({
      session: null,
      error: new Response(JSON.stringify({ error: { code: "FORBIDDEN" } }), { status: 403 }),
    });

    const req = new NextRequest("http://localhost/api/users");
    const res = await listUsers(req);

    expect(res.status).toBe(403);
  });
});

describe("GET /api/users/me", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns current user", async () => {
    mockCheckAuth.mockResolvedValue({
      session: { user: { id: "user-1" } },
      error: undefined,
    });
    mockFindUnique.mockResolvedValue({ id: "user-1", name: "Test", email: "test@horacemann.org" });

    const req = new NextRequest("http://localhost/api/users/me");
    const res = await getMe(req);

    expect(res.status).toBe(200);
    expect(mockFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          id: true,
          encryptedDek: true,
          dekKekVersion: true,
          nameCiphertext: true,
          emailCiphertext: true,
        }),
      })
    );
  });
});

describe("GET /api/users/[id]", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns public profile", async () => {
    mockFindUnique.mockResolvedValue({
      id: "user-1",
      name: "Test",
      role: "WRITER",
      articleCredits: [],
    });

    const req = new NextRequest("http://localhost/api/users/user-1");
    const res = await getUser(req, { params: Promise.resolve({ id: "user-1" }) });

    expect(res.status).toBe(200);
    // No email here (public profile) but name/image envelope columns are required.
    expect(mockFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          id: true,
          encryptedDek: true,
          dekKekVersion: true,
          nameCiphertext: true,
          imageCiphertext: true,
        }),
      })
    );
  });
});
