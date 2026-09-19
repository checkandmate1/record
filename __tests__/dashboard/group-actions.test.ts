jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("next/navigation", () => ({ redirect: jest.fn() }));
jest.mock("@/lib/page-cache", () => ({ invalidateHomepage: jest.fn() }));
jest.mock("@/lib/s3", () => ({
  deleteS3Object: jest.fn(),
  getS3ObjectHead: jest.fn(),
}));
jest.mock("@/lib/prisma", () => {
  const articleGroup = {
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    create: jest.fn(),
  };
  const layoutBlock = {
    findFirst: jest.fn(),
    create: jest.fn(),
    deleteMany: jest.fn(),
    updateMany: jest.fn(),
  };
  const blockSlot = { updateMany: jest.fn() };
  const article = { findFirst: jest.fn() };
  const approval = { create: jest.fn(), findUnique: jest.fn(), delete: jest.fn() };
  const client = { articleGroup, layoutBlock, blockSlot, article, approval };
  return {
    prisma: {
      ...client,
      // addBlock runs MAX(order)+1 + create inside an interactive transaction;
      // reorderBlocks passes an array of prepared operations.
      $transaction: jest.fn(async (arg: unknown) =>
        Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: typeof client) => unknown)(client),
      ),
    },
  };
});

import {
  addBlock,
  approveGroup,
  assignMediaToBlockSlot,
  assignToBlockSlot,
  clearBlockSlot,
  deleteBlock,
  deleteGroup,
  removeGroupApproval,
  reorderBlocks,
  scheduleGroup,
  updateDividerStyle,
  updateMediaCredit,
  updateSlotScale,
} from "@/app/dashboard/group-actions";
import { isS3Url } from "@/app/dashboard/group-schemas";
import { auth } from "@/lib/auth";
import { invalidateHomepage } from "@/lib/page-cache";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

const mockAuth = auth as unknown as jest.Mock;
const db = prisma as unknown as {
  articleGroup: { findUnique: jest.Mock; update: jest.Mock; delete: jest.Mock };
  layoutBlock: {
    findFirst: jest.Mock;
    create: jest.Mock;
    deleteMany: jest.Mock;
    updateMany: jest.Mock;
  };
  blockSlot: { updateMany: jest.Mock };
  article: { findFirst: jest.Mock };
  approval: { create: jest.Mock; findUnique: jest.Mock; delete: jest.Mock };
  $transaction: jest.Mock;
};

const BUCKET = "record-test-bucket";
const REGION = "us-east-2";
const S3_URL = `https://${BUCKET}.s3.${REGION}.amazonaws.com/uploads/u1/abc.jpg`;
const S3_GLOBAL_URL = `https://${BUCKET}.s3.amazonaws.com/uploads/u1/abc.jpg`;

const writer = { user: { id: "w1", role: "WRITER" } };
const photographer = { user: { id: "p1", role: "PHOTOGRAPHER" } };
const editor = { user: { id: "e1", role: "EDITOR" } };

function groupStatus(status: "DRAFT" | "PUBLISHED" | null) {
  db.articleGroup.findUnique.mockResolvedValue(status === null ? null : { status });
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.AWS_S3_BUCKET = BUCKET;
  process.env.AWS_REGION = REGION;
  mockAuth.mockResolvedValue(writer);
  groupStatus("DRAFT");
  db.blockSlot.updateMany.mockResolvedValue({ count: 1 });
  db.layoutBlock.updateMany.mockResolvedValue({ count: 1 });
  db.layoutBlock.deleteMany.mockResolvedValue({ count: 1 });
  db.layoutBlock.findFirst.mockResolvedValue({ order: 2 });
  db.layoutBlock.create.mockResolvedValue({ id: "b-new" });
});

/* ------------------------------------------------------------------ */
/* 1. requireGroupMutable — published issues are editor-only           */
/* ------------------------------------------------------------------ */

describe("published-issue gate", () => {
  it("blocks a WRITER from adding a block to a published issue", async () => {
    groupStatus("PUBLISHED");
    await expect(addBlock("g1", "main", "hero")).rejects.toThrow(/published/i);
    expect(db.layoutBlock.create).not.toHaveBeenCalled();
  });

  it("blocks a PHOTOGRAPHER from replacing media on a published issue", async () => {
    mockAuth.mockResolvedValue(photographer);
    groupStatus("PUBLISHED");
    await expect(
      assignMediaToBlockSlot("s1", S3_URL, "image", "alt", "", "g1"),
    ).rejects.toThrow(/published/i);
    expect(db.blockSlot.updateMany).not.toHaveBeenCalled();
  });

  it("blocks a WRITER from deleting a block on a published issue", async () => {
    groupStatus("PUBLISHED");
    await expect(deleteBlock("b1", "g1")).rejects.toThrow(/published/i);
    expect(db.layoutBlock.deleteMany).not.toHaveBeenCalled();
  });

  it("blocks a WRITER from reordering a published issue", async () => {
    groupStatus("PUBLISHED");
    await expect(reorderBlocks("g1", "main", ["b1", "b2"])).rejects.toThrow(/published/i);
  });

  it("blocks a WRITER from changing slot settings on a published issue", async () => {
    groupStatus("PUBLISHED");
    await expect(updateSlotScale("s1", "L", "g1")).rejects.toThrow(/published/i);
  });

  it("lets an EDITOR change a published issue", async () => {
    mockAuth.mockResolvedValue(editor);
    groupStatus("PUBLISHED");
    await expect(updateSlotScale("s1", "L", "g1")).resolves.toBeUndefined();
    expect(db.blockSlot.updateMany).toHaveBeenCalled();
  });

  it("lets a WRITER change a draft issue", async () => {
    groupStatus("DRAFT");
    await expect(updateSlotScale("s1", "L", "g1")).resolves.toBeUndefined();
    expect(db.blockSlot.updateMany).toHaveBeenCalled();
  });

  it("rejects an unknown issue id", async () => {
    groupStatus(null);
    await expect(updateSlotScale("s1", "L", "nope")).rejects.toThrow("Issue not found");
  });

  it("still rejects a READER before it looks at the issue", async () => {
    mockAuth.mockResolvedValue({ user: { id: "r1", role: "READER" } });
    await expect(updateSlotScale("s1", "L", "g1")).rejects.toThrow("Dashboard access required");
    expect(db.articleGroup.findUnique).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* 2. Group scoping                                                     */
/* ------------------------------------------------------------------ */

describe("group scoping", () => {
  it("scopes deleteBlock to the group", async () => {
    await deleteBlock("b1", "g1");
    expect(db.layoutBlock.deleteMany).toHaveBeenCalledWith({
      where: { id: "b1", groupId: "g1" },
    });
  });

  it("throws when the block is not in the group", async () => {
    db.layoutBlock.deleteMany.mockResolvedValue({ count: 0 });
    await expect(deleteBlock("b-other", "g1")).rejects.toThrow(/not (in|part of) this issue/i);
  });

  it("scopes updateDividerStyle to the group", async () => {
    await updateDividerStyle("b1", "bold", "g1");
    expect(db.layoutBlock.updateMany).toHaveBeenCalledWith({
      where: { id: "b1", groupId: "g1" },
      data: { dividerStyle: "bold" },
    });
  });

  it("scopes slot updates through the owning block", async () => {
    await updateSlotScale("s1", "XL", "g1");
    expect(db.blockSlot.updateMany).toHaveBeenCalledWith({
      where: { id: "s1", block: { groupId: "g1" } },
      data: { scale: "XL" },
    });
  });

  it("throws when the slot is not in the group", async () => {
    db.blockSlot.updateMany.mockResolvedValue({ count: 0 });
    await expect(clearBlockSlot("s-other", "g1")).rejects.toThrow(/not (in|part of) this issue/i);
  });

  it("rejects an article that belongs to another issue", async () => {
    db.article.findFirst.mockResolvedValue(null);
    await expect(assignToBlockSlot("s1", "a-other", "g1")).rejects.toThrow(/not in this issue/i);
    expect(db.blockSlot.updateMany).not.toHaveBeenCalled();
  });

  it("accepts an article that belongs to the issue", async () => {
    db.article.findFirst.mockResolvedValue({ id: "a1" });
    await assignToBlockSlot("s1", "a1", "g1");
    expect(db.article.findFirst).toHaveBeenCalledWith({
      where: { id: "a1", groupId: "g1" },
      select: { id: true },
    });
    expect(db.blockSlot.updateMany).toHaveBeenCalledWith({
      where: { id: "s1", block: { groupId: "g1" } },
      data: { articleId: "a1" },
    });
  });

  it("clears a slot without looking up an article", async () => {
    await assignToBlockSlot("s1", null, "g1");
    expect(db.article.findFirst).not.toHaveBeenCalled();
    expect(db.blockSlot.updateMany).toHaveBeenCalled();
  });

  it("rejects approving an issue that does not exist", async () => {
    groupStatus(null);
    await expect(approveGroup("nope")).rejects.toThrow("Issue not found");
    expect(db.approval.create).not.toHaveBeenCalled();
  });

  it("rejects removing an approval that belongs to another issue", async () => {
    db.approval.findUnique.mockResolvedValue({ id: "ap1", userId: "w1", groupId: "g2" });
    await expect(removeGroupApproval("ap1", "g1")).rejects.toThrow(/this issue/i);
    expect(db.approval.delete).not.toHaveBeenCalled();
  });

  it("removes an approval that belongs to the issue", async () => {
    db.approval.findUnique.mockResolvedValue({ id: "ap1", userId: "w1", groupId: "g1" });
    await removeGroupApproval("ap1", "g1");
    expect(db.approval.delete).toHaveBeenCalledWith({ where: { id: "ap1" } });
  });
});

/* ------------------------------------------------------------------ */
/* 3. Input validation                                                  */
/* ------------------------------------------------------------------ */

describe("isS3Url", () => {
  it("accepts both bucket host forms", () => {
    expect(isS3Url(S3_URL)).toBe(true);
    expect(isS3Url(S3_GLOBAL_URL)).toBe(true);
  });

  it("rejects another bucket, another host, http and data URLs", () => {
    expect(isS3Url(`https://other.s3.${REGION}.amazonaws.com/x.jpg`)).toBe(false);
    expect(isS3Url(`https://evil.com/${BUCKET}.s3.amazonaws.com/x.jpg`)).toBe(false);
    expect(isS3Url(`http://${BUCKET}.s3.amazonaws.com/x.jpg`)).toBe(false);
    expect(isS3Url("data:image/png;base64,AAAA")).toBe(false);
    expect(isS3Url("not a url")).toBe(false);
    expect(isS3Url(`https://${BUCKET}.s3.amazonaws.com.evil.com/x.jpg`)).toBe(false);
  });

  it("rejects everything when the bucket is not configured", () => {
    delete process.env.AWS_S3_BUCKET;
    expect(isS3Url(S3_GLOBAL_URL)).toBe(false);
  });
});

describe("assignMediaToBlockSlot validation", () => {
  it("stores media served from the configured bucket", async () => {
    await assignMediaToBlockSlot("s1", S3_URL, "image", "A photo", "Jane", "g1");
    expect(db.blockSlot.updateMany).toHaveBeenCalledWith({
      where: { id: "s1", block: { groupId: "g1" } },
      data: { mediaUrl: S3_URL, mediaType: "image", mediaAlt: "A photo", mediaCredit: "Jane" },
    });
  });

  it("rejects a base64 data URL", async () => {
    await expect(
      assignMediaToBlockSlot("s1", "data:image/png;base64,AAAA", "image", "", "", "g1"),
    ).rejects.toThrow(/media/i);
    expect(db.blockSlot.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a URL on another host", async () => {
    await expect(
      assignMediaToBlockSlot("s1", "https://evil.example.com/x.jpg", "image", "", "", "g1"),
    ).rejects.toThrow(/media/i);
  });

  it("rejects an unknown media type", async () => {
    await expect(
      assignMediaToBlockSlot("s1", S3_URL, "script", "", "", "g1"),
    ).rejects.toThrow(/media/i);
  });

  it("rejects alt text over 300 characters", async () => {
    await expect(
      assignMediaToBlockSlot("s1", S3_URL, "image", "a".repeat(301), "", "g1"),
    ).rejects.toThrow(/media/i);
  });
});

describe("updateDividerStyle / updateMediaCredit validation", () => {
  it("accepts the three styles the toolbar offers", async () => {
    for (const style of ["light", "bold", "none"]) {
      await updateDividerStyle("b1", style, "g1");
    }
    expect(db.layoutBlock.updateMany).toHaveBeenCalledTimes(3);
  });

  it("rejects an unknown divider style", async () => {
    await expect(updateDividerStyle("b1", "sparkly", "g1")).rejects.toThrow(/divider/i);
    expect(db.layoutBlock.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a credit over 300 characters", async () => {
    await expect(updateMediaCredit("s1", "c".repeat(301), "g1")).rejects.toThrow(/credit/i);
    expect(db.blockSlot.updateMany).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* 4. Atomic reorder / add                                              */
/* ------------------------------------------------------------------ */

describe("atomic block ordering", () => {
  it("reorders in one transaction, scoped to the group and column", async () => {
    await reorderBlocks("g1", "main", ["b2", "b1"]);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.layoutBlock.updateMany).toHaveBeenCalledTimes(2);
    expect(db.layoutBlock.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: "b2", groupId: "g1", column: "main" },
      data: { order: 0 },
    });
    expect(db.layoutBlock.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: "b1", groupId: "g1", column: "main" },
      data: { order: 1 },
    });
  });

  it("rejects a reorder that names a block outside the group", async () => {
    db.layoutBlock.updateMany.mockResolvedValue({ count: 0 });
    await expect(reorderBlocks("g1", "main", ["b-other"])).rejects.toThrow(/this issue/i);
  });

  it("computes the next order inside the transaction", async () => {
    await addBlock("g1", "main", "hero");
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.layoutBlock.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { groupId: "g1", column: "main" } }),
    );
    expect(db.layoutBlock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ groupId: "g1", column: "main", order: 3 }),
      }),
    );
  });

  it("rejects an unknown pattern before touching the database", async () => {
    await expect(addBlock("g1", "main", "no-such-pattern")).rejects.toThrow("Unknown pattern");
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* 5 + 6. Homepage invalidation and scheduling                          */
/* ------------------------------------------------------------------ */

describe("deleteGroup", () => {
  it("invalidates the homepage", async () => {
    mockAuth.mockResolvedValue(editor);
    db.articleGroup.findUnique.mockResolvedValue({ pdfKey: null });
    await deleteGroup("g1");
    expect(revalidatePath).toHaveBeenCalledWith("/");
    expect(invalidateHomepage).toHaveBeenCalled();
  });
});

describe("scheduleGroup", () => {
  function fd(value: string) {
    const f = new FormData();
    f.set("scheduledAt", value);
    return f;
  }

  beforeEach(() => {
    mockAuth.mockResolvedValue(editor);
  });

  it("stores a future instant sent with an explicit offset", async () => {
    const iso = new Date(Date.now() + 86_400_000).toISOString();
    await scheduleGroup("g1", fd(iso));
    expect(db.articleGroup.update).toHaveBeenCalledWith({
      where: { id: "g1" },
      data: { scheduledAt: new Date(iso) },
    });
    expect(invalidateHomepage).toHaveBeenCalled();
  });

  it("accepts a numeric UTC offset", async () => {
    const future = new Date(Date.now() + 86_400_000);
    const value = `${future.toISOString().slice(0, 19)}+00:00`;
    await scheduleGroup("g1", fd(value));
    expect(db.articleGroup.update).toHaveBeenCalledWith({
      where: { id: "g1" },
      data: { scheduledAt: new Date(value) },
    });
  });

  it("rejects a timezone-less datetime-local value", async () => {
    await expect(scheduleGroup("g1", fd("2099-01-01T18:00"))).rejects.toThrow(/offset/i);
    expect(db.articleGroup.update).not.toHaveBeenCalled();
  });

  it("rejects a date in the past", async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    await expect(scheduleGroup("g1", fd(past))).rejects.toThrow(/future/i);
  });

  it("rejects a WRITER", async () => {
    mockAuth.mockResolvedValue(writer);
    await expect(scheduleGroup("g1", fd(new Date(Date.now() + 1000).toISOString()))).rejects.toThrow(
      "Editor access required",
    );
  });
});
