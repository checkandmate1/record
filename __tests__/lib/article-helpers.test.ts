import { stripHtml, getPreviewText, getInitials } from "@/lib/article-helpers";

describe("stripHtml", () => {
  it("strips tags from a normal string", () => {
    expect(stripHtml("<p>Hello <b>World</b></p>")).toBe("Hello World");
  });

  it("returns empty string for null", () => {
    expect(stripHtml(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(stripHtml(undefined)).toBe("");
  });

  it("returns empty string for empty string", () => {
    expect(stripHtml("")).toBe("");
  });
});

describe("getPreviewText", () => {
  it("truncates long plain text with an ellipsis", () => {
    const body = "word ".repeat(100).trim();
    const preview = getPreviewText(body, 20);
    expect(preview.length).toBeLessThanOrEqual(24);
    expect(preview.endsWith("...")).toBe(true);
  });

  it("returns short text unchanged", () => {
    expect(getPreviewText("<p>Hi</p>", 200)).toBe("Hi");
  });

  it("returns empty string for null body (decrypt failure) instead of throwing", () => {
    expect(() => getPreviewText(null, 140)).not.toThrow();
    expect(getPreviewText(null, 140)).toBe("");
  });

  it("returns empty string for undefined body instead of throwing", () => {
    expect(getPreviewText(undefined)).toBe("");
  });
});

describe("getInitials", () => {
  it("returns the first letter of a name, uppercased", () => {
    expect(getInitials("michael")).toBe("M");
  });

  it("returns a fallback for null name instead of throwing", () => {
    expect(() => getInitials(null)).not.toThrow();
    expect(getInitials(null)).toBe("?");
  });

  it("returns a fallback for undefined name instead of throwing", () => {
    expect(getInitials(undefined)).toBe("?");
  });

  it("returns a fallback for an empty-string name instead of throwing", () => {
    expect(getInitials("")).toBe("?");
  });
});
