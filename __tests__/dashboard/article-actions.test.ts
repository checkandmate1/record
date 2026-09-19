// Server actions are a public HTTP surface: anything a browser can POST reaches them, so these
// tests cover the authorization gates and the Zod payload validation, not the happy path only.
// Mock shape follows __tests__/api/author-actions.test.ts.
jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("next/navigation", () => ({ redirect: jest.fn() }));
jest.mock("@/lib/page-cache", () => ({ invalidateHomepage: jest.fn() }));
jest.mock("@/lib/slugify", () => ({ generateUniqueSlug: jest.fn(async () => "a-slug") }));
jest.mock("@/lib/prisma", () => {
  const article = {
    create: jest.fn(),
    update: jest.fn(),
    findUnique: jest.fn(),
    delete: jest.fn(),
  };
  const articleCredit = { deleteMany: jest.fn() };
  const articleGroup = { findUnique: jest.fn() };
  const client = { article, articleCredit, articleGroup };
  return {
    prisma: {
      ...client,
      // updateArticle wraps credit delete + article update in one interactive transaction.
      $transaction: jest.fn(async (cb: (tx: typeof client) => unknown) => cb(client)),
    },
  };
});

import {
  createArticleInGroup,
  updateArticle,
} from "@/app/dashboard/article-actions";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { invalidateHomepage } from "@/lib/page-cache";

const mockAuth = auth as unknown as jest.Mock;
const mockArticle = prisma.article as unknown as {
  create: jest.Mock;
  update: jest.Mock;
  findUnique: jest.Mock;
  delete: jest.Mock;
};
const mockCredit = prisma.articleCredit as unknown as { deleteMany: jest.Mock };
const mockGroup = (prisma as unknown as { articleGroup: { findUnique: jest.Mock } }).articleGroup;
const mockTransaction = (prisma as unknown as { $transaction: jest.Mock }).$transaction;

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const AUTHOR_ID = "33333333-3333-4333-8333-333333333333";
const GROUP_ID = "44444444-4444-4444-8444-444444444444";

const BUCKET = "record-test-bucket";
const REGION = "us-east-2";
const S3_IMAGE_URL = `https://${BUCKET}.s3.${REGION}.amazonaws.com/uploads/${OWNER_ID}/abc.jpg`;

const writerSession = { user: { id: OWNER_ID, role: "WRITER" } };
const otherWriterSession = { user: { id: OTHER_ID, role: "WRITER" } };
const editorSession = { user: { id: OTHER_ID, role: "EDITOR" } };

function articleForm(overrides: Record<string, string> = {}, creditCount = 1): FormData {
  const fd = new FormData();
  fd.set("title", "A Headline");
  fd.set("body", "Some body text");
  fd.set("section", "NEWS");
  for (const [k, v] of Object.entries(overrides)) {
    if (v === "") fd.delete(k);
    else fd.set(k, v);
  }
  for (let i = 0; i < creditCount; i++) {
    fd.set(`credit_user_${i}`, AUTHOR_ID);
    fd.set(`credit_role_${i}`, "Staff Writer");
  }
  return fd;
}

beforeEach(() => {
  jest.clearAllMocks();
  // isS3Url reads the bucket/region from the environment at call time.
  process.env.AWS_S3_BUCKET = BUCKET;
  process.env.AWS_REGION = REGION;
  mockAuth.mockResolvedValue(writerSession);
  mockGroup.findUnique.mockResolvedValue({ id: GROUP_ID, status: "DRAFT" });
  mockArticle.findUnique.mockResolvedValue({
    createdById: OWNER_ID,
    group: { status: "DRAFT" },
  });
  mockArticle.create.mockResolvedValue({ id: "new-article" });
  mockArticle.update.mockResolvedValue({ id: "a1" });
  mockCredit.deleteMany.mockResolvedValue({ count: 0 });
});

describe("updateArticle authorization", () => {
  it("rejects a non-owner writer", async () => {
    mockAuth.mockResolvedValue(otherWriterSession);
    await expect(updateArticle("a1", articleForm())).rejects.toThrow(
      "You can only edit your own articles",
    );
    expect(mockArticle.update).not.toHaveBeenCalled();
  });

  it("rejects a READER outright", async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID, role: "READER" } });
    await expect(updateArticle("a1", articleForm())).rejects.toThrow("Dashboard access required");
  });

  it("throws when the article does not exist", async () => {
    mockArticle.findUnique.mockResolvedValue(null);
    await expect(updateArticle("a1", articleForm())).rejects.toThrow("Article not found");
  });

  it("rejects the owner when the article's group is PUBLISHED", async () => {
    mockArticle.findUnique.mockResolvedValue({
      createdById: OWNER_ID,
      group: { status: "PUBLISHED" },
    });
    await expect(updateArticle("a1", articleForm())).rejects.toThrow(
      "Only editors can edit published articles",
    );
    expect(mockArticle.update).not.toHaveBeenCalled();
  });

  it("allows an editor to edit someone else's published article", async () => {
    mockAuth.mockResolvedValue(editorSession);
    mockArticle.findUnique.mockResolvedValue({
      createdById: OWNER_ID,
      group: { status: "PUBLISHED" },
    });
    await updateArticle("a1", articleForm());
    expect(mockArticle.update).toHaveBeenCalled();
  });

  it("allows the owner on a draft article and writes inside a transaction", async () => {
    await updateArticle("a1", articleForm());
    expect(mockTransaction).toHaveBeenCalled();
    expect(mockCredit.deleteMany).toHaveBeenCalledWith({ where: { articleId: "a1" } });
    expect(mockArticle.update).toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/");
    expect(invalidateHomepage).toHaveBeenCalled();
  });
});

describe("updateArticle validation", () => {
  it("rejects a missing title", async () => {
    await expect(updateArticle("a1", articleForm({ title: "" }))).rejects.toThrow(
      "Title, body, and section are required",
    );
  });

  it("rejects a title longer than 300 characters", async () => {
    await expect(
      updateArticle("a1", articleForm({ title: "x".repeat(301) })),
    ).rejects.toThrow(/300/);
    expect(mockArticle.update).not.toHaveBeenCalled();
  });

  it("rejects an unknown section", async () => {
    await expect(updateArticle("a1", articleForm({ section: "SPORTS" }))).rejects.toThrow();
    expect(mockArticle.update).not.toHaveBeenCalled();
  });

  it("rejects a body over 100 KB", async () => {
    await expect(
      updateArticle("a1", articleForm({ body: "x".repeat(102401) })),
    ).rejects.toThrow();
    expect(mockArticle.update).not.toHaveBeenCalled();
  });

  it("still rejects an article titled Media", async () => {
    await expect(updateArticle("a1", articleForm({ title: "Media" }))).rejects.toThrow(
      "Articles cannot be titled 'Media'",
    );
  });

  it("rejects a featured image with a dangerous scheme", async () => {
    await expect(
      updateArticle("a1", articleForm({ featuredImage: "javascript:alert(1)" })),
    ).rejects.toThrow();
    expect(mockArticle.update).not.toHaveBeenCalled();
  });

  it("rejects a base64 data URL featured image", async () => {
    await expect(
      updateArticle("a1", articleForm({ featuredImage: "data:image/png;base64,AAAA" })),
    ).rejects.toThrow(/upload bucket/i);
    expect(mockArticle.update).not.toHaveBeenCalled();
  });

  it("rejects an https featured image outside the upload bucket", async () => {
    await expect(
      updateArticle("a1", articleForm({ featuredImage: "https://evil.example.com/pic.jpg" })),
    ).rejects.toThrow(/upload bucket/i);
    expect(mockArticle.update).not.toHaveBeenCalled();
  });

  it("accepts a featured image in the site's S3 bucket", async () => {
    await updateArticle("a1", articleForm({ featuredImage: S3_IMAGE_URL }));
    expect(mockArticle.update.mock.calls[0][0].data.featuredImage).toBe(S3_IMAGE_URL);
  });

  it("stores null when no featured image is submitted", async () => {
    await updateArticle("a1", articleForm());
    expect(mockArticle.update.mock.calls[0][0].data.featuredImage).toBeNull();
  });

  it("accepts a featured image on create", async () => {
    await expect(
      createArticleInGroup(GROUP_ID, articleForm({ featuredImage: S3_IMAGE_URL })),
    ).resolves.not.toThrow();
    expect(mockArticle.create.mock.calls[0][0].data.featuredImage).toBe(S3_IMAGE_URL);
  });

  it("rejects a data URL featured image on create", async () => {
    await expect(
      createArticleInGroup(GROUP_ID, articleForm({ featuredImage: "data:image/png;base64,AAAA" })),
    ).rejects.toThrow(/upload bucket/i);
    expect(mockArticle.create).not.toHaveBeenCalled();
  });
});

describe("credit parsing is bounded", () => {
  it("accepts 50 credits", async () => {
    await updateArticle("a1", articleForm({}, 50));
    expect(mockArticle.update).toHaveBeenCalled();
  });

  it("rejects more than 50 credits", async () => {
    await expect(updateArticle("a1", articleForm({}, 51))).rejects.toThrow(/50 authors/);
    expect(mockArticle.update).not.toHaveBeenCalled();
  });

  it("ignores a bogus credit_count and reads the real indexed fields", async () => {
    const fd = articleForm({}, 2);
    fd.set("credit_count", "100000");
    await updateArticle("a1", fd);
    const data = mockArticle.update.mock.calls[0][0].data;
    expect(data.credits.create).toHaveLength(2);
  });

  it("rejects a credit userId that is not an id", async () => {
    const fd = articleForm({}, 1);
    fd.set("credit_user_0", "not-an-id");
    await expect(updateArticle("a1", fd)).rejects.toThrow();
  });
});

describe("createArticleInGroup", () => {
  it("rejects a writer adding to a PUBLISHED group", async () => {
    mockGroup.findUnique.mockResolvedValue({ id: GROUP_ID, status: "PUBLISHED" });
    await expect(createArticleInGroup(GROUP_ID, articleForm())).rejects.toThrow(
      "Only editors can add articles to a published issue",
    );
    expect(mockArticle.create).not.toHaveBeenCalled();
  });

  it("allows an editor to add to a PUBLISHED group", async () => {
    mockAuth.mockResolvedValue(editorSession);
    mockGroup.findUnique.mockResolvedValue({ id: GROUP_ID, status: "PUBLISHED" });
    await createArticleInGroup(GROUP_ID, articleForm());
    expect(mockArticle.create).toHaveBeenCalled();
  });

  it("throws when the group does not exist", async () => {
    mockGroup.findUnique.mockResolvedValue(null);
    await expect(createArticleInGroup(GROUP_ID, articleForm())).rejects.toThrow("Group not found");
  });

  it("invalidates the homepage cache", async () => {
    await createArticleInGroup(GROUP_ID, articleForm());
    expect(revalidatePath).toHaveBeenCalledWith("/");
    expect(invalidateHomepage).toHaveBeenCalled();
  });

  it("rejects more than 50 credits", async () => {
    await expect(createArticleInGroup(GROUP_ID, articleForm({}, 51))).rejects.toThrow(
      /50 authors/,
    );
    expect(mockArticle.create).not.toHaveBeenCalled();
  });
});
