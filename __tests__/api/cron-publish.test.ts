import { NextRequest } from "next/server";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    articleGroup: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/page-cache", () => ({ invalidateHomepage: jest.fn() }));

import { POST } from "@/app/api/cron/publish-scheduled/route";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { invalidateHomepage } from "@/lib/page-cache";

const mockFindMany = prisma.articleGroup.findMany as jest.Mock;
const mockFindUnique = prisma.articleGroup.findUnique as jest.Mock;
const mockUpdate = prisma.articleGroup.update as jest.Mock;
const mockRevalidate = revalidatePath as jest.Mock;
const mockInvalidate = invalidateHomepage as jest.Mock;

const SECRET = "test-cron-secret-0123456789";

function makeRequest(authorization?: string): NextRequest {
  return new NextRequest("http://localhost/api/cron/publish-scheduled", {
    method: "POST",
    headers: authorization ? { authorization } : {},
  });
}

// `publishGroupById` reads each group's volume/issue numbers before promoting it.
function groupReady(id: string) {
  return { id, volumeNumber: 123, issueNumber: 4 };
}

let consoleError: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.CRON_SECRET = SECRET;
  mockFindMany.mockResolvedValue([]);
  mockUpdate.mockResolvedValue({});
  consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
});

describe("POST /api/cron/publish-scheduled — auth", () => {
  it("401s with no Authorization header", async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("401s with the wrong secret", async () => {
    const res = await POST(makeRequest("Bearer wrong-secret"));
    expect(res.status).toBe(401);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("401s with a same-length but different secret", async () => {
    const wrong = "x".repeat(SECRET.length);
    const res = await POST(makeRequest(`Bearer ${wrong}`));
    expect(res.status).toBe(401);
  });

  it("401s when the scheme is not Bearer", async () => {
    const res = await POST(makeRequest(`Basic ${SECRET}`));
    expect(res.status).toBe(401);
  });

  it("500s with a clear log when CRON_SECRET is unset", async () => {
    delete process.env.CRON_SECRET;
    const res = await POST(makeRequest(`Bearer ${SECRET}`));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("CRON_NOT_CONFIGURED");
    expect(consoleError).toHaveBeenCalled();
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("accepts the correct secret", async () => {
    const res = await POST(makeRequest(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
  });
});

describe("POST /api/cron/publish-scheduled — publishing", () => {
  it("queries only DRAFT groups whose scheduledAt has passed", async () => {
    await POST(makeRequest(`Bearer ${SECRET}`));
    const where = mockFindMany.mock.calls[0][0].where;
    expect(where.status).toBe("DRAFT");
    expect(where.scheduledAt.not).toBeNull();
    expect(where.scheduledAt.lte).toBeInstanceOf(Date);
  });

  it("publishes every due group and reports their ids", async () => {
    mockFindMany.mockResolvedValue([{ id: "g1" }, { id: "g2" }]);
    mockFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      groupReady(where.id),
    );

    const res = await POST(makeRequest(`Bearer ${SECRET}`));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ published: ["g1", "g2"], skipped: [] });
    expect(mockUpdate).toHaveBeenCalledTimes(2);
    expect(mockUpdate.mock.calls[0][0].where).toEqual({ id: "g1" });
    expect(mockUpdate.mock.calls[0][0].data.status).toBe("PUBLISHED");
    expect(mockUpdate.mock.calls[0][0].data.publishedAt).toBeInstanceOf(Date);
    // The schedule is consumed, otherwise unpublishing would silently re-fire it.
    expect(mockUpdate.mock.calls[0][0].data.scheduledAt).toBeNull();
  });

  it("revalidates and invalidates the homepage cache once per published group", async () => {
    mockFindMany.mockResolvedValue([{ id: "g1" }]);
    mockFindUnique.mockResolvedValue(groupReady("g1"));

    await POST(makeRequest(`Bearer ${SECRET}`));

    expect(mockRevalidate).toHaveBeenCalledWith("/");
    expect(mockInvalidate).toHaveBeenCalledTimes(1);
  });

  it("does nothing when nothing is due", async () => {
    const res = await POST(makeRequest(`Bearer ${SECRET}`));
    const body = await res.json();
    expect(body).toEqual({ published: [], skipped: [] });
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockInvalidate).not.toHaveBeenCalled();
  });

  it("skips a group with no volume/issue number and reports the reason", async () => {
    mockFindMany.mockResolvedValue([{ id: "g1" }, { id: "g2" }]);
    mockFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === "g1"
        ? { id: "g1", volumeNumber: null, issueNumber: 4 }
        : groupReady("g2"),
    );

    const res = await POST(makeRequest(`Bearer ${SECRET}`));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.published).toEqual(["g2"]);
    expect(body.skipped).toHaveLength(1);
    expect(body.skipped[0].id).toBe("g1");
    expect(body.skipped[0].reason).toMatch(/volume/i);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it("reports a group that vanished rather than throwing", async () => {
    mockFindMany.mockResolvedValue([{ id: "gone" }]);
    mockFindUnique.mockResolvedValue(null);

    const res = await POST(makeRequest(`Bearer ${SECRET}`));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.published).toEqual([]);
    expect(body.skipped).toEqual([{ id: "gone", reason: "Issue not found" }]);
  });

  it("keeps going when one group's update blows up", async () => {
    mockFindMany.mockResolvedValue([{ id: "g1" }, { id: "g2" }]);
    mockFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      groupReady(where.id),
    );
    mockUpdate.mockRejectedValueOnce(new Error("db exploded"));

    const res = await POST(makeRequest(`Bearer ${SECRET}`));
    const body = await res.json();

    expect(body.published).toEqual(["g2"]);
    expect(body.skipped).toEqual([{ id: "g1", reason: "db exploded" }]);
  });
});
