import { prisma } from "@/lib/prisma";
import { searchAll, issueLabel, SEARCH_EXCERPT_MAX, type SearchResultItem } from "@/lib/search";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    article: { findMany: jest.fn() },
    articleGroup: { findMany: jest.fn() },
  },
}));

const mockPrisma = prisma as unknown as {
  article: { findMany: jest.Mock };
  articleGroup: { findMany: jest.Mock };
};

function article(overrides: Record<string, unknown> = {}) {
  return {
    id: "a1",
    title: "A Title",
    slug: "a-title",
    body: "Hello world body text.",
    section: "NEWS",
    createdBy: { id: "u1", name: "Jane Doe" },
    credits: [],
    group: { publishedAt: new Date("2026-01-02T00:00:00Z") },
    ...overrides,
  };
}

function firstArticle(results: SearchResultItem[]) {
  const item = results[0];
  if (!item || item.kind !== "article") throw new Error("expected an article result");
  return item;
}

describe("searchAll", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.article.findMany.mockResolvedValue([]);
    mockPrisma.articleGroup.findMany.mockResolvedValue([]);
  });

  it("returns an excerpt, never the full body", async () => {
    mockPrisma.article.findMany.mockResolvedValue([article({ body: "x ".repeat(50_000) })]);

    const item = firstArticle(await searchAll("title"));

    expect(item).not.toHaveProperty("body");
    expect(item.excerpt.length).toBeLessThanOrEqual(SEARCH_EXCERPT_MAX);
  });

  it("strips tags out of the excerpt", async () => {
    mockPrisma.article.findMany.mockResolvedValue([
      article({ body: "<p>Hello <strong>world</strong></p>" }),
    ]);

    expect(firstArticle(await searchAll("title")).excerpt).toBe("Hello world");
  });

  it("keeps comparison operators in the excerpt (same rule as sanitizeHtml)", async () => {
    mockPrisma.article.findMany.mockResolvedValue([
      article({ body: "<p>The team proved x < y and z > w today.</p>" }),
    ]);

    expect(firstArticle(await searchAll("title")).excerpt).toBe(
      "The team proved x < y and z > w today.",
    );
  });

  it("ends a truncated excerpt with an ellipsis, still within the cap", async () => {
    mockPrisma.article.findMany.mockResolvedValue([
      article({ body: "lorem ipsum ".repeat(400) }),
    ]);

    const { excerpt } = firstArticle(await searchAll("title"));

    expect(excerpt.endsWith("…")).toBe(true);
    expect(excerpt.length).toBeLessThanOrEqual(SEARCH_EXCERPT_MAX);
  });

  it("tolerates a null body", async () => {
    mockPrisma.article.findMany.mockResolvedValue([article({ body: null })]);

    expect(firstArticle(await searchAll("title")).excerpt).toBe("");
  });

  it("matches on title only — the dead body-contains branch is gone", async () => {
    await searchAll("hello");

    const where = mockPrisma.article.findMany.mock.calls[0][0].where;
    expect(where.OR).toBeUndefined();
    expect(where.title).toEqual({ contains: "hello", mode: "insensitive" });
  });

  it("caps the query at 100 characters before it reaches the database", async () => {
    await searchAll("q".repeat(500));

    const where = mockPrisma.article.findMany.mock.calls[0][0].where;
    expect(where.title.contains).toHaveLength(100);
  });

  it("returns nothing for an empty query without hitting the database", async () => {
    expect(await searchAll("   ")).toEqual([]);
    expect(mockPrisma.article.findMany).not.toHaveBeenCalled();
  });

  it("still interleaves issue PDFs, newest first", async () => {
    mockPrisma.article.findMany.mockResolvedValue([
      article({ group: { publishedAt: new Date("2026-01-01T00:00:00Z") } }),
    ]);
    mockPrisma.articleGroup.findMany.mockResolvedValue([
      {
        id: "g1",
        name: null,
        volumeNumber: 123,
        issueNumber: 26,
        pdfFilename: null,
        publishedAt: new Date("2026-02-01T00:00:00Z"),
      },
    ]);

    const results = await searchAll("26");

    expect(results.map((r) => r.kind)).toEqual(["issue", "article"]);
    expect(results[0]!.title).toBe("Issue 26 · Volume 123");
  });
});

describe("issueLabel", () => {
  it("falls back through name then filename", () => {
    expect(
      issueLabel({
        volumeNumber: null,
        issueNumber: null,
        name: "Spring Special",
        pdfFilename: "x.pdf",
      }),
    ).toBe("Spring Special");
    expect(
      issueLabel({ volumeNumber: null, issueNumber: null, name: null, pdfFilename: "x.pdf" }),
    ).toBe("x.pdf");
  });
});
