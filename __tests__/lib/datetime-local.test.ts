import { localInputToIso, isoToLocalInput } from "@/lib/datetime-local";

describe("localInputToIso", () => {
  it("returns null for an empty or whitespace value", () => {
    expect(localInputToIso("")).toBeNull();
    expect(localInputToIso("   ")).toBeNull();
  });

  it("returns null for an unparseable value", () => {
    expect(localInputToIso("not-a-date")).toBeNull();
  });

  it("interprets a bare datetime-local value in the local zone", () => {
    // `new Date("2026-09-20T18:00")` (no offset) is local time per ES2015+.
    expect(localInputToIso("2026-09-20T18:00")).toBe(
      new Date("2026-09-20T18:00").toISOString(),
    );
  });

  it("always produces an ISO instant with an explicit UTC offset", () => {
    const iso = localInputToIso("2026-09-20T18:00");
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("accepts a value that includes seconds", () => {
    expect(localInputToIso("2026-09-20T18:00:30")).toBe(
      new Date("2026-09-20T18:00:30").toISOString(),
    );
  });
});

describe("isoToLocalInput", () => {
  it("returns an empty string for null/empty/invalid input", () => {
    expect(isoToLocalInput(null)).toBe("");
    expect(isoToLocalInput("")).toBe("");
    expect(isoToLocalInput("nonsense")).toBe("");
  });

  it("formats an instant as a datetime-local value, zero-padded", () => {
    const value = isoToLocalInput("2026-09-20T18:00:00.000Z");
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it("round-trips with localInputToIso", () => {
    const local = "2026-09-20T18:00";
    const iso = localInputToIso(local);
    expect(iso).not.toBeNull();
    expect(isoToLocalInput(iso as string)).toBe(local);
  });
});
