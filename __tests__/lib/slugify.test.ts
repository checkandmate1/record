import {
  generateUniqueSlug,
  generateUniqueRoundTableSlug,
  withRandomSuffix,
  isSlugConflict,
  insertWithSlugRetry,
} from "@/lib/slugify";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    article: {
      findMany: jest.fn(),
    },
    roundTable: {
      findMany: jest.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";

const mockArticleFindMany = prisma.article.findMany as jest.Mock;
const mockRoundTableFindMany = prisma.roundTable.findMany as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockArticleFindMany.mockResolvedValue([]);
  mockRoundTableFindMany.mockResolvedValue([]);
});

describe("generateUniqueSlug", () => {
  it("generates a basic slug from title", async () => {
    expect(await generateUniqueSlug("Hello World")).toBe("hello-world");
  });

  it("uses a single findMany rather than a findFirst loop", async () => {
    mockArticleFindMany.mockResolvedValue([
      { slug: "hello-world" },
      { slug: "hello-world-2" },
      { slug: "hello-world-3" },
    ]);
    expect(await generateUniqueSlug("Hello World")).toBe("hello-world-4");
    expect(mockArticleFindMany).toHaveBeenCalledTimes(1);
    expect(mockArticleFindMany).toHaveBeenCalledWith({
      where: { slug: { startsWith: "hello-world" } },
      select: { slug: true },
    });
  });

  it("appends the first free numeric suffix, not the next one after the highest", async () => {
    mockArticleFindMany.mockResolvedValue([
      { slug: "hello-world" },
      { slug: "hello-world-3" },
    ]);
    expect(await generateUniqueSlug("Hello World")).toBe("hello-world-2");
  });

  it("ignores rows that merely start with the base but are not suffix collisions", async () => {
    mockArticleFindMany.mockResolvedValue([{ slug: "hello-world-cup" }]);
    expect(await generateUniqueSlug("Hello World")).toBe("hello-world");
  });

  it("falls back to 'untitled' for an empty title", async () => {
    expect(await generateUniqueSlug("")).toBe("untitled");
  });

  it("falls back to 'untitled' for a whitespace-only title", async () => {
    expect(await generateUniqueSlug("   \n\t ")).toBe("untitled");
  });

  it("falls back to 'untitled' for a symbol-only title", async () => {
    expect(await generateUniqueSlug("!!! ??? ***")).toBe("untitled");
  });

  it("excludes the row being updated from the collision check", async () => {
    await generateUniqueSlug("Hello World", "article-1");
    expect(mockArticleFindMany).toHaveBeenCalledWith({
      where: { slug: { startsWith: "hello-world" }, NOT: { id: "article-1" } },
      select: { slug: true },
    });
  });

  it("keeps the current slug when only the row being updated holds it", async () => {
    // findMany is called with NOT: { id }, so the excluded row's slug never comes back.
    mockArticleFindMany.mockResolvedValue([]);
    expect(await generateUniqueSlug("Hello World", "article-1")).toBe("hello-world");
  });
});

describe("generateUniqueRoundTableSlug", () => {
  it("generates a slug from the prompt", async () => {
    expect(await generateUniqueRoundTableSlug("Should school start later?")).toBe(
      "should-school-start-later",
    );
  });

  it("picks the first free suffix in one query", async () => {
    mockRoundTableFindMany.mockResolvedValue([{ slug: "a-prompt" }]);
    expect(await generateUniqueRoundTableSlug("A prompt")).toBe("a-prompt-2");
    expect(mockRoundTableFindMany).toHaveBeenCalledTimes(1);
  });

  it("falls back to 'round-table' for an empty prompt", async () => {
    expect(await generateUniqueRoundTableSlug("   ")).toBe("round-table");
  });

  it("excludes the round table being updated", async () => {
    await generateUniqueRoundTableSlug("A prompt", "rt-1");
    expect(mockRoundTableFindMany).toHaveBeenCalledWith({
      where: { slug: { startsWith: "a-prompt" }, NOT: { id: "rt-1" } },
      select: { slug: true },
    });
  });

  it("does not gratuitously bump a re-saved round table to -2", async () => {
    mockRoundTableFindMany.mockResolvedValue([]);
    expect(await generateUniqueRoundTableSlug("A prompt", "rt-1")).toBe("a-prompt");
  });
});

describe("withRandomSuffix", () => {
  it("appends a 4-character suffix", () => {
    const slug = withRandomSuffix("hello-world");
    expect(slug).toMatch(/^hello-world-[a-z0-9]{4}$/);
  });

  // It must NOT strip a trailing 4-char segment: that segment is usually a real word, and
  // eating it would hand back a different article's slug.
  it("keeps a real 4-letter trailing word", () => {
    expect(withRandomSuffix("hello-world-news")).toMatch(/^hello-world-news-[a-z0-9]{4}$/);
  });
});

describe("isSlugConflict", () => {
  it("recognises a Prisma P2002 on the slug column", () => {
    expect(isSlugConflict({ code: "P2002", meta: { target: ["slug"] } })).toBe(true);
    expect(isSlugConflict({ code: "P2002", meta: { target: "Article_slug_key" } })).toBe(true);
  });

  it("rejects other errors", () => {
    expect(isSlugConflict({ code: "P2002", meta: { target: ["email"] } })).toBe(false);
    expect(isSlugConflict({ code: "P2025" })).toBe(false);
    expect(isSlugConflict(new Error("boom"))).toBe(false);
    expect(isSlugConflict(null)).toBe(false);
  });
});

describe("insertWithSlugRetry", () => {
  it("returns the first result when there is no conflict", async () => {
    const insert = jest.fn(async (slug: string) => ({ slug }));
    await expect(insertWithSlugRetry("hello-world", insert)).resolves.toEqual({
      slug: "hello-world",
    });
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it("retries once with a random suffix on a slug conflict", async () => {
    const insert = jest
      .fn()
      .mockRejectedValueOnce({ code: "P2002", meta: { target: ["slug"] } })
      .mockImplementation(async (slug: string) => ({ slug }));
    const result = (await insertWithSlugRetry("hello-world", insert)) as { slug: string };
    expect(insert).toHaveBeenCalledTimes(2);
    expect(result.slug).toMatch(/^hello-world-[a-z0-9]{4}$/);
  });

  it("gives up after one retry", async () => {
    const conflict = { code: "P2002", meta: { target: ["slug"] } };
    const insert = jest.fn().mockRejectedValue(conflict);
    await expect(insertWithSlugRetry("hello-world", insert)).rejects.toBe(conflict);
    expect(insert).toHaveBeenCalledTimes(2);
  });

  it("does not retry other errors", async () => {
    const insert = jest.fn().mockRejectedValue(new Error("boom"));
    await expect(insertWithSlugRetry("hello-world", insert)).rejects.toThrow("boom");
    expect(insert).toHaveBeenCalledTimes(1);
  });
});
