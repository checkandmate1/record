import { cropRatioClass, parseCropRatio } from "@/app/patterns/crop";

describe("cropRatioClass", () => {
  it("maps the presets to CSS aspect-ratio values", () => {
    expect(cropRatioClass("landscape", null)).toBe("16/9");
    expect(cropRatioClass("portrait", null)).toBe("3/4");
    expect(cropRatioClass("square", null)).toBe("1/1");
  });

  it("returns undefined for 'original' so the image keeps its natural size", () => {
    expect(cropRatioClass("original", null)).toBeUndefined();
  });

  it("returns undefined for a missing or unknown crop", () => {
    expect(cropRatioClass(null, null)).toBeUndefined();
    expect(cropRatioClass(undefined, null)).toBeUndefined();
    expect(cropRatioClass("diagonal", null)).toBeUndefined();
  });

  it("reads a custom ratio", () => {
    expect(cropRatioClass("custom", "21:9")).toBe("21/9");
    expect(cropRatioClass("custom", "2:3")).toBe("2/3");
  });

  it("ignores a custom crop whose ratio is missing or malformed", () => {
    expect(cropRatioClass("custom", null)).toBeUndefined();
    expect(cropRatioClass("custom", "")).toBeUndefined();
    expect(cropRatioClass("custom", "16")).toBeUndefined();
    expect(cropRatioClass("custom", "16:9:3")).toBeUndefined();
    expect(cropRatioClass("custom", "wide")).toBeUndefined();
    expect(cropRatioClass("custom", "0:9")).toBeUndefined();
    expect(cropRatioClass("custom", "-16:9")).toBeUndefined();
  });

  it("does not fall back to a preset when the crop is custom", () => {
    expect(cropRatioClass("custom", "square")).toBeUndefined();
  });
});

describe("parseCropRatio", () => {
  it("returns the numeric ratio for the presets", () => {
    expect(parseCropRatio("landscape", null)).toBeCloseTo(16 / 9);
    expect(parseCropRatio("portrait", null)).toBeCloseTo(3 / 4);
    expect(parseCropRatio("square", null)).toBe(1);
  });

  it("returns null when the image is unconstrained", () => {
    expect(parseCropRatio("original", null)).toBeNull();
    expect(parseCropRatio(null, null)).toBeNull();
    expect(parseCropRatio("custom", null)).toBeNull();
    expect(parseCropRatio("custom", "nonsense")).toBeNull();
  });

  it("returns the numeric ratio for a custom crop", () => {
    expect(parseCropRatio("custom", "21:9")).toBeCloseTo(21 / 9);
  });

  it("agrees with cropRatioClass", () => {
    for (const crop of ["original", "landscape", "portrait", "square", "custom"]) {
      const css = cropRatioClass(crop, "4:3");
      const num = parseCropRatio(crop, "4:3");
      expect(css === undefined).toBe(num === null);
    }
  });
});
