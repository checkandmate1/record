import { GET, POST } from "@/app/api/articles/route";
import { NextRequest } from "next/server";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    article: {
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
    },
  },
}));

jest.mock("@/lib/middleware/auth", () => ({
  checkRole: jest.fn(),
}));

jest.mock("@/lib/slugify", () => ({
  generateUniqueSlug: jest.fn(),
}));

jest.mock("@/lib/sanitize", () => ({
  sanitizeHtml: jest.fn((html: string) => html),
}));

import { prisma } from "@/lib/prisma";
import { checkRole } from "@/lib/middleware/auth";
import { generateUniqueSlug } from "@/lib/slugify";
import { sanitizeHtml } from "@/lib/sanitize";

const mockFindMany = prisma.article.findMany as jest.Mock;
const mockCount = prisma.article.count as jest.Mock;
const mockCreate = prisma.article.create as jest.Mock;
const mockCheckRole = checkRole as jest.Mock;
const mockGenerateUniqueSlug = generateUniqueSlug as jest.Mock;
const mockSanitizeHtml = sanitizeHtml as jest.Mock;

const mockArticle = {
  id: "article-1",
  title: "Test Article",
  slug: "test-article",
  body: "<p>Content</p>",
  excerpt: "Test excerpt",
  featuredImage: null,
  section: "NEWS",
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  createdById: "user-1",
  createdBy: { id: "user-1", name: "Editor", email: "editor@example.com", image: null },
  credits: [],
  images: [],
};

const BUCKET = "record-test-bucket";
const REGION = "us-east-2";
const S3_IMAGE_URL = `https://${BUCKET}.s3.${REGION}.amazonaws.com/uploads/user-1/abc.jpg`;

function makeRequest(url: string): NextRequest {
  return new NextRequest(url);
}

function makePostRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/articles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/articles", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns paginated published articles", async () => {
    mockFindMany.mockResolvedValue([mockArticle]);
    mockCount.mockResolvedValue(1);

    const req = makeRequest("http://localhost/api/articles");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.pagination).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 });
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ group: { status: "PUBLISHED" } }),
      })
    );
  });

  it("filters by section", async () => {
    mockFindMany.mockResolvedValue([mockArticle]);
    mockCount.mockResolvedValue(1);

    const req = makeRequest("http://localhost/api/articles?section=NEWS");
    await GET(req);

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ group: { status: "PUBLISHED" }, section: "NEWS" }),
      })
    );
  });

  it("applies search filter on title and excerpt", async () => {
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);

    const req = makeRequest("http://localhost/api/articles?search=hello");
    await GET(req);

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { title: { contains: "hello", mode: "insensitive" } },
            { excerpt: { contains: "hello", mode: "insensitive" } },
          ],
        }),
      })
    );
  });

  it("returns correct pagination for page 2", async () => {
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(25);

    const req = makeRequest("http://localhost/api/articles?page=2&limit=10");
    const res = await GET(req);
    const body = await res.json();

    expect(body.pagination).toEqual({ page: 2, limit: 10, total: 25, totalPages: 3 });
  });

  it("returns 400 for invalid query params", async () => {
    const req = makeRequest("http://localhost/api/articles?section=INVALID");
    const res = await GET(req);
    expect(res.status).toBe(400);
  });
});

describe("POST /api/articles", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // isS3Url (via createArticleSchema.featuredImage) reads these at call time.
    process.env.AWS_S3_BUCKET = BUCKET;
    process.env.AWS_REGION = REGION;
  });

  it("returns 401 when not authenticated", async () => {
    mockCheckRole.mockResolvedValue({
      session: null,
      error: { status: 401, json: async () => ({ error: { code: "UNAUTHORIZED", message: "You must be signed in" } }) },
    });

    const req = makePostRequest({ title: "Test", body: "<p>Content</p>", section: "NEWS" });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 403 when user is not editor", async () => {
    mockCheckRole.mockResolvedValue({
      session: null,
      error: { status: 403, json: async () => ({ error: { code: "FORBIDDEN", message: "Forbidden" } }) },
    });

    const req = makePostRequest({ title: "Test", body: "<p>Content</p>", section: "NEWS" });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("creates article for editor", async () => {
    mockCheckRole.mockResolvedValue({
      session: { user: { id: "user-1", role: "EDITOR", isAdmin: false } },
      error: undefined,
    });
    mockGenerateUniqueSlug.mockResolvedValue("test-article");
    mockSanitizeHtml.mockReturnValue("<p>Content</p>");
    mockCreate.mockResolvedValue(mockArticle);

    const req = makePostRequest({
      title: "Test Article",
      body: "<p>Content</p>",
      section: "NEWS",
      groupId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.id).toBe("article-1");
    expect(mockCreate).toHaveBeenCalled();
  });

  it("creates article with credits", async () => {
    mockCheckRole.mockResolvedValue({
      session: { user: { id: "user-1", role: "EDITOR", isAdmin: false } },
      error: undefined,
    });
    mockGenerateUniqueSlug.mockResolvedValue("test-article");
    mockSanitizeHtml.mockReturnValue("<p>Content</p>");
    mockCreate.mockResolvedValue(mockArticle);

    const req = makePostRequest({
      title: "Test Article",
      body: "<p>Content</p>",
      section: "NEWS",
      groupId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
      credits: [{ userId: "550e8400-e29b-41d4-a716-446655440000", creditRole: "Author" }],
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          credits: expect.objectContaining({
            create: [{ userId: "550e8400-e29b-41d4-a716-446655440000", creditRole: "Author" }],
          }),
        }),
      })
    );
  });

  it("returns 400 for invalid body", async () => {
    mockCheckRole.mockResolvedValue({
      session: { user: { id: "user-1", role: "EDITOR", isAdmin: false } },
      error: undefined,
    });

    const req = makePostRequest({ title: "", section: "NEWS" });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 for a base64 data URL featured image", async () => {
    mockCheckRole.mockResolvedValue({
      session: { user: { id: "user-1", role: "EDITOR", isAdmin: false } },
      error: undefined,
    });

    const req = makePostRequest({
      title: "Test Article",
      body: "<p>Content</p>",
      section: "NEWS",
      groupId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
      featuredImage: "data:image/png;base64,AAAA",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns 400 for an https featured image outside the upload bucket", async () => {
    mockCheckRole.mockResolvedValue({
      session: { user: { id: "user-1", role: "EDITOR", isAdmin: false } },
      error: undefined,
    });

    const req = makePostRequest({
      title: "Test Article",
      body: "<p>Content</p>",
      section: "NEWS",
      groupId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
      featuredImage: "https://evil.example.com/pic.jpg",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("accepts a featured image in the site's S3 bucket", async () => {
    mockCheckRole.mockResolvedValue({
      session: { user: { id: "user-1", role: "EDITOR", isAdmin: false } },
      error: undefined,
    });
    mockGenerateUniqueSlug.mockResolvedValue("test-article");
    mockSanitizeHtml.mockReturnValue("<p>Content</p>");
    mockCreate.mockResolvedValue(mockArticle);

    const req = makePostRequest({
      title: "Test Article",
      body: "<p>Content</p>",
      section: "NEWS",
      groupId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
      featuredImage: S3_IMAGE_URL,
    });
    const res = await POST(req);

    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ featuredImage: S3_IMAGE_URL }),
      })
    );
  });

  it("sanitizes html body before saving", async () => {
    mockCheckRole.mockResolvedValue({
      session: { user: { id: "user-1", role: "EDITOR", isAdmin: false } },
      error: undefined,
    });
    mockGenerateUniqueSlug.mockResolvedValue("test-article");
    mockSanitizeHtml.mockReturnValue("<p>Safe content</p>");
    mockCreate.mockResolvedValue(mockArticle);

    const req = makePostRequest({
      title: "Test Article",
      body: "<script>alert('xss')</script><p>Content</p>",
      section: "NEWS",
      groupId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    });
    await POST(req);

    expect(mockSanitizeHtml).toHaveBeenCalledWith("<script>alert('xss')</script><p>Content</p>");
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ body: "<p>Safe content</p>" }),
      })
    );
  });
});
