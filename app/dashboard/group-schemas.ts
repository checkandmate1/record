import { z } from "zod";

/**
 * Zod schemas for the group/layout server actions.
 *
 * These live here rather than in `lib/validations.ts` because they describe
 * server-action arguments, not HTTP request bodies — `lib/validations.ts` is the
 * API layer's schema file. Keep this module free of `"use server"`: it exports
 * plain values and sync helpers, and `group-actions.ts` imports from it.
 */

/** Divider styles the block toolbar offers (`layout-builder.tsx`). */
export const DIVIDER_STYLES = ["light", "bold", "none"] as const;

/** Scales understood by `lib/scale.ts`. */
export const SLOT_SCALES = ["S", "M", "L", "XL"] as const;

/** Upper bound for the free-text fields attached to slot media. */
export const MEDIA_TEXT_MAX = 300;

/** Anything longer than this is not a URL we minted. */
const MEDIA_URL_MAX = 2048;

/**
 * True when `url` points at an object in the configured S3 bucket over https.
 *
 * Both addressing forms the SDK/console hand out are accepted:
 *   https://<bucket>.s3.amazonaws.com/<key>
 *   https://<bucket>.s3.<region>.amazonaws.com/<key>
 * (`POST /api/upload` returns the second.) Everything else — data: URLs, http,
 * another bucket, a look-alike host, an embedded userinfo or port — is rejected.
 *
 * Exported so other media-accepting actions can reuse the same rule.
 */
export function isS3Url(url: string): boolean {
  const bucket = process.env.AWS_S3_BUCKET;
  if (!bucket || url.length > MEDIA_URL_MAX) return false;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:") return false;
  if (parsed.username || parsed.password || parsed.port) return false;

  const region = process.env.AWS_REGION;
  const hosts = [`${bucket}.s3.amazonaws.com`];
  if (region) hosts.push(`${bucket}.s3.${region}.amazonaws.com`);

  return hosts.includes(parsed.hostname.toLowerCase());
}

export const dividerStyleSchema = z.enum(DIVIDER_STYLES);
export const slotScaleSchema = z.enum(SLOT_SCALES);
export const mediaCreditSchema = z.string().max(MEDIA_TEXT_MAX);

export const slotMediaSchema = z.object({
  mediaUrl: z
    .string()
    .max(MEDIA_URL_MAX)
    .refine(isS3Url, "Media must be an https URL in the site's upload bucket"),
  mediaType: z.enum(["image", "video"]),
  mediaAlt: z.string().max(MEDIA_TEXT_MAX),
  mediaCredit: z.string().max(MEDIA_TEXT_MAX),
});

export type SlotMedia = z.infer<typeof slotMediaSchema>;

/**
 * `parse` with a caller-supplied prefix, so a failure reaches the editor as
 * "Invalid media: …" instead of a raw ZodError dump in the route error boundary.
 */
export function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first?.path.length ? ` (${first.path.join(".")})` : "";
    throw new Error(`Invalid ${label}${path}: ${first?.message ?? "validation failed"}`);
  }
  return result.data;
}
