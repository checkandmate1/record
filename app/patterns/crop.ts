/**
 * Slot image crop helpers.
 *
 * `BlockSlot.imageCrop` is one of the presets validated by `imageCropSchema`
 * (`app/dashboard/group-schemas.ts`) — "original" | "landscape" | "portrait" |
 * "square" | "custom" — and when it is "custom", `BlockSlot.imageCropCustom`
 * holds a "W:H" string such as "16:9".
 *
 * Two consumers need two shapes, so both live here rather than being retyped as
 * a ternary in every pattern:
 *
 * - patterns need a CSS `aspect-ratio` **value** ("16/9") for `imgStyle` →
 *   `cropRatioClass()`
 * - `editable.tsx` needs the **number** (w / h) to size the drag wrapper →
 *   `parseCropRatio()`
 *
 * This is a plain module (no `"use client"`), like `placeholder.ts`, so the
 * server-component patterns can import it.
 */

/** Preset crop → CSS `aspect-ratio` value. "original" is absent: it means "don't constrain". */
const CROP_RATIOS: Record<string, string> = {
  landscape: "16/9",
  portrait: "3/4",
  square: "1/1",
};

/** "16:9" → [16, 9]. Anything malformed, zero or negative is rejected. */
function parseCustom(custom: string | null | undefined): [number, number] | null {
  if (!custom) return null;
  const parts = custom.split(":");
  if (parts.length !== 2) return null;
  const w = Number(parts[0]);
  const h = Number(parts[1]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return [w, h];
}

/**
 * The CSS `aspect-ratio` value for a slot's crop, or `undefined` when the image
 * should keep its natural proportions ("original", an unknown preset, or a
 * "custom" crop with no usable ratio string).
 */
export function cropRatioClass(
  crop: string | null | undefined,
  custom: string | null | undefined,
): string | undefined {
  if (crop === "custom") {
    const parsed = parseCustom(custom);
    return parsed ? `${parsed[0]}/${parsed[1]}` : undefined;
  }
  return CROP_RATIOS[crop ?? ""] ?? undefined;
}

/**
 * The same crop as a number (width / height), or `null` for "no constraint".
 * `editable.tsx` uses it for `style.aspectRatio` on the resize wrapper and to
 * decide between `object-fit: cover` and `contain`.
 */
export function parseCropRatio(
  crop: string | null | undefined,
  custom: string | null | undefined,
): number | null {
  const ratio = cropRatioClass(crop, custom);
  if (!ratio) return null;
  const [w, h] = ratio.split("/").map(Number);
  return w / h;
}
