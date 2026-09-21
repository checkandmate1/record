jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("next/navigation", () => ({ redirect: jest.fn() }));
jest.mock("@/lib/page-cache", () => ({ invalidateHomepage: jest.fn() }));
jest.mock("@/lib/slugify", () => ({
  generateUniqueRoundTableSlug: jest.fn(async () => "regenerated-slug"),
}));
jest.mock("@/lib/prisma", () => {
  const roundTable = { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() };
  const roundTableSide = { findMany: jest.fn(), update: jest.fn(), create: jest.fn() };
  const roundTableSideAuthor = { deleteMany: jest.fn(), createMany: jest.fn() };
  const roundTableTurn = { deleteMany: jest.fn(), createMany: jest.fn() };
  const articleGroup = { findUnique: jest.fn() };
  const client = {
    roundTable,
    roundTableSide,
    roundTableSideAuthor,
    roundTableTurn,
    articleGroup,
  };
  return {
    prisma: {
      ...client,
      $transaction: jest.fn(async (cb: (tx: typeof client) => unknown) => cb(client)),
    },
  };
});

import {
  createRoundTable,
  updateRoundTable,
  deleteRoundTable,
} from "@/app/dashboard/roundtable-actions";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { invalidateHomepage } from "@/lib/page-cache";
import { generateUniqueRoundTableSlug } from "@/lib/slugify";

const mockAuth = auth as unknown as jest.Mock;
const db = prisma as unknown as {
  roundTable: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock; delete: jest.Mock };
  roundTableSide: { findMany: jest.Mock; update: jest.Mock; create: jest.Mock };
  roundTableSideAuthor: { deleteMany: jest.Mock; createMany: jest.Mock };
  roundTableTurn: { deleteMany: jest.Mock; createMany: jest.Mock };
  articleGroup: { findUnique: jest.Mock };
  $transaction: jest.Mock;
};
const mockSlug = generateUniqueRoundTableSlug as jest.Mock;

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const GROUP_ID = "44444444-4444-4444-8444-444444444444";
const SIDE_0 = "55555555-5555-4555-8555-555555555555";
const SIDE_1 = "66666666-6666-4666-8666-666666666666";

const writerSession = { user: { id: USER_A, role: "WRITER" } };
const editorSession = { user: { id: USER_B, role: "EDITOR" } };

function roundTableForm(
  overrides: { prompt?: string; turns?: number; sides?: number; authors?: string } = {},
): FormData {
  const fd = new FormData();
  fd.set("prompt", overrides.prompt ?? "Should we do X?");
  const sides = overrides.sides ?? 2;
  for (let i = 0; i < sides; i++) {
    fd.set(`side_${i}_id`, i === 0 ? SIDE_0 : SIDE_1);
    fd.set(`side_${i}_label`, `Side ${i + 1}`);
    fd.set(`side_${i}_authors`, overrides.authors ?? "");
  }
  const turns = overrides.turns ?? 2;
  for (let i = 0; i < turns; i++) {
    fd.set(`turn_${i}_side`, String(i % 2));
    fd.set(`turn_${i}_body`, `Turn ${i}`);
  }
  return fd;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue(writerSession);
  db.roundTable.findUnique.mockResolvedValue({
    id: "rt1",
    groupId: GROUP_ID,
    slug: "should-we-do-x",
    prompt: "Should we do X?",
    group: { status: "DRAFT" },
  });
  db.roundTable.update.mockResolvedValue({ id: "rt1", groupId: GROUP_ID });
  db.roundTable.create.mockResolvedValue({ id: "rt1" });
  db.roundTableSide.findMany.mockResolvedValue([
    { id: SIDE_0, order: 0 },
    { id: SIDE_1, order: 1 },
  ]);
  db.roundTableSide.update.mockResolvedValue({ id: SIDE_0 });
  db.roundTableSide.create.mockResolvedValue({ id: SIDE_1 });
  db.roundTableSideAuthor.deleteMany.mockResolvedValue({ count: 0 });
  db.roundTableSideAuthor.createMany.mockResolvedValue({ count: 0 });
  db.roundTableTurn.deleteMany.mockResolvedValue({ count: 0 });
  db.roundTableTurn.createMany.mockResolvedValue({ count: 0 });
  db.articleGroup.findUnique.mockResolvedValue({ id: GROUP_ID, status: "DRAFT" });
});

describe("updateRoundTable authorization", () => {
  it("rejects a READER", async () => {
    mockAuth.mockResolvedValue({ user: { id: USER_A, role: "READER" } });
    await expect(updateRoundTable("rt1", roundTableForm())).rejects.toThrow(
      "Dashboard access required",
    );
  });

  it("throws when the round table does not exist", async () => {
    db.roundTable.findUnique.mockResolvedValue(null);
    await expect(updateRoundTable("rt1", roundTableForm())).rejects.toThrow(
      "Round table not found",
    );
  });

  it("rejects a non-editor when the issue is PUBLISHED", async () => {
    db.roundTable.findUnique.mockResolvedValue({
      id: "rt1",
      groupId: GROUP_ID,
      slug: "s",
      prompt: "Should we do X?",
      group: { status: "PUBLISHED" },
    });
    await expect(updateRoundTable("rt1", roundTableForm())).rejects.toThrow(
      "Only editors can edit published round tables",
    );
    expect(db.roundTable.update).not.toHaveBeenCalled();
  });

  it("allows an editor when the issue is PUBLISHED", async () => {
    mockAuth.mockResolvedValue(editorSession);
    db.roundTable.findUnique.mockResolvedValue({
      id: "rt1",
      groupId: GROUP_ID,
      slug: "s",
      prompt: "Should we do X?",
      group: { status: "PUBLISHED" },
    });
    await updateRoundTable("rt1", roundTableForm());
    expect(db.roundTable.update).toHaveBeenCalled();
  });
});

describe("updateRoundTable validation and bounds", () => {
  it("rejects a missing prompt", async () => {
    await expect(
      updateRoundTable("rt1", roundTableForm({ prompt: "" })),
    ).rejects.toThrow("Prompt is required");
  });

  it("rejects a prompt over 500 characters", async () => {
    await expect(
      updateRoundTable("rt1", roundTableForm({ prompt: "x".repeat(501) })),
    ).rejects.toThrow(/500/);
  });

  it("rejects anything other than exactly two sides", async () => {
    await expect(updateRoundTable("rt1", roundTableForm({ sides: 3 }))).rejects.toThrow(
      "A round table must have exactly two sides",
    );
  });

  it("accepts 100 turns", async () => {
    await updateRoundTable("rt1", roundTableForm({ turns: 100 }));
    expect(db.roundTableTurn.createMany).toHaveBeenCalled();
  });

  it("rejects more than 100 turns", async () => {
    await expect(updateRoundTable("rt1", roundTableForm({ turns: 101 }))).rejects.toThrow(
      /100 turns/,
    );
    expect(db.roundTable.update).not.toHaveBeenCalled();
  });

  it("ignores a forged turn_count and reads the real indexed fields", async () => {
    const fd = roundTableForm({ turns: 3 });
    fd.set("turn_count", "999999");
    fd.set("side_count", "999999");
    await updateRoundTable("rt1", fd);
    const rows = db.roundTableTurn.createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(3);
  });

  it("rejects an author id that is not an id", async () => {
    await expect(
      updateRoundTable("rt1", roundTableForm({ authors: "not-an-id" })),
    ).rejects.toThrow();
  });
});

describe("updateRoundTable slug", () => {
  it("regenerates the slug when the prompt changed", async () => {
    await updateRoundTable("rt1", roundTableForm({ prompt: "A brand new question?" }));
    // The row being updated is excluded so its own slug is not a collision.
    expect(mockSlug).toHaveBeenCalledWith("A brand new question?", "rt1");
    expect(db.roundTable.update.mock.calls[0][0].data.slug).toBe("regenerated-slug");
  });

  it("keeps the old slug when the prompt is unchanged", async () => {
    await updateRoundTable("rt1", roundTableForm({ prompt: "Should we do X?" }));
    expect(mockSlug).not.toHaveBeenCalled();
    expect(db.roundTable.update.mock.calls[0][0].data.slug).toBeUndefined();
  });
});

describe("updateRoundTable writes atomically", () => {
  it("performs the side/turn replacement inside a transaction", async () => {
    await updateRoundTable("rt1", roundTableForm());
    expect(db.$transaction).toHaveBeenCalled();
    expect(db.roundTableTurn.deleteMany).toHaveBeenCalledWith({ where: { roundTableId: "rt1" } });
  });
});

describe("createRoundTable", () => {
  it("invalidates the homepage cache", async () => {
    db.roundTable.findUnique.mockResolvedValue(null);
    await createRoundTable(GROUP_ID);
    expect(revalidatePath).toHaveBeenCalledWith("/");
    expect(invalidateHomepage).toHaveBeenCalled();
  });
});

describe("deleteRoundTable", () => {
  it("revalidates the homepage and invalidates its cache", async () => {
    mockAuth.mockResolvedValue(editorSession);
    db.roundTable.findUnique.mockResolvedValue({ groupId: GROUP_ID });
    db.roundTable.delete.mockResolvedValue({ id: "rt1" });
    await deleteRoundTable("rt1");
    expect(revalidatePath).toHaveBeenCalledWith("/");
    expect(invalidateHomepage).toHaveBeenCalled();
  });

  it("stays EDITOR+ only", async () => {
    await expect(deleteRoundTable("rt1")).rejects.toThrow("Editor access required");
  });
});
