jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: jest.fn(), update: jest.fn() } },
}));

import { updateProfilePicture, resetProfilePicture } from "@/app/account/account-actions";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const mockAuth = auth as unknown as jest.Mock;
const mockUser = prisma.user as unknown as { findUnique: jest.Mock; update: jest.Mock };

const ME = "11111111-1111-4111-8111-111111111111";
const SOMEONE_ELSE = "22222222-2222-4222-8222-222222222222";

// 1x1 transparent PNG.
const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: ME, role: "WRITER" } });
  mockUser.update.mockResolvedValue({ id: ME });
  mockUser.findUnique.mockResolvedValue({
    id: ME,
    googleImage: "https://lh3.googleusercontent.com/a/photo",
  });
});

describe("updateProfilePicture", () => {
  it("rejects editing someone else's picture", async () => {
    await expect(updateProfilePicture(SOMEONE_ELSE, PNG_DATA_URL)).rejects.toThrow(
      "Not authorized",
    );
    expect(mockUser.update).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated caller", async () => {
    mockAuth.mockResolvedValue(null);
    await expect(updateProfilePicture(ME, PNG_DATA_URL)).rejects.toThrow("Not authorized");
  });

  it("accepts a PNG data URL", async () => {
    await updateProfilePicture(ME, PNG_DATA_URL);
    expect(mockUser.update).toHaveBeenCalledWith({
      where: { id: ME },
      data: { image: PNG_DATA_URL },
    });
  });

  it("rejects a javascript: URL", async () => {
    await expect(updateProfilePicture(ME, "javascript:alert(1)")).rejects.toThrow();
    expect(mockUser.update).not.toHaveBeenCalled();
  });

  it("rejects a non-image data URL", async () => {
    await expect(
      updateProfilePicture(ME, "data:text/html;base64,PHNjcmlwdD4="),
    ).rejects.toThrow();
    expect(mockUser.update).not.toHaveBeenCalled();
  });

  it("rejects an SVG data URL", async () => {
    await expect(
      updateProfilePicture(ME, "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="),
    ).rejects.toThrow();
    expect(mockUser.update).not.toHaveBeenCalled();
  });

  it("rejects a data URL over 1 MB", async () => {
    const huge = `data:image/png;base64,${"A".repeat(1_000_001)}`;
    await expect(updateProfilePicture(ME, huge)).rejects.toThrow();
    expect(mockUser.update).not.toHaveBeenCalled();
  });

  it("rejects a plain http URL", async () => {
    await expect(updateProfilePicture(ME, "http://example.com/a.png")).rejects.toThrow();
  });
});

describe("resetProfilePicture", () => {
  it("rejects resetting someone else's picture", async () => {
    await expect(resetProfilePicture(SOMEONE_ELSE)).rejects.toThrow("Not authorized");
    expect(mockUser.update).not.toHaveBeenCalled();
  });

  it("reads googleImage from the database rather than trusting the caller", async () => {
    await resetProfilePicture(ME);
    expect(mockUser.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ME } }),
    );
    expect(mockUser.update).toHaveBeenCalledWith({
      where: { id: ME },
      data: { image: "https://lh3.googleusercontent.com/a/photo" },
    });
  });

  it("selects the envelope columns needed to decrypt the user row", async () => {
    await resetProfilePicture(ME);
    const select = mockUser.findUnique.mock.calls[0][0].select;
    expect(select).toEqual(expect.objectContaining({ googleImage: true, encryptedDek: true }));
  });

  it("clears the picture when there is no Google photo", async () => {
    mockUser.findUnique.mockResolvedValue({ id: ME, googleImage: null });
    await resetProfilePicture(ME);
    expect(mockUser.update).toHaveBeenCalledWith({ where: { id: ME }, data: { image: null } });
  });

  it("throws when the user row is gone", async () => {
    mockUser.findUnique.mockResolvedValue(null);
    await expect(resetProfilePicture(ME)).rejects.toThrow("User not found");
  });
});
