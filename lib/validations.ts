import { z } from "zod";
import { ALL_ROLES } from "@/lib/roles";

// `z.string().url()` accepts `javascript:` and `data:` URLs which are dangerous in href/src contexts.
// Restrict to http(s) by default; opt-in to `data:image/*` for fields like Article.featuredImage that
// the dashboard form intentionally writes as base64 data URLs (see app/dashboard/CLAUDE.md).
function isAllowedUrl(value: string, allowDataImage: boolean): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol === "http:" || parsed.protocol === "https:") return true;
  if (allowDataImage && parsed.protocol === "data:") {
    const meta = value.slice("data:".length).split(",", 1)[0] ?? "";
    return meta.startsWith("image/");
  }
  return false;
}

const safeUrl = (allowDataImage = false) =>
  z.string().refine((v) => isAllowedUrl(v, allowDataImage), {
    message: allowDataImage
      ? "URL must use http(s) or data:image/* scheme"
      : "URL must use http(s) scheme",
  });

// Cap featuredImage at ~1MB of characters. Comfortably fits typical hero-image data URLs but
// rejects multi-MB base64 payloads that bloat Postgres rows.
const FEATURED_IMAGE_MAX = 1_000_000;

export const createArticleSchema = z.object({
  title: z.string().min(1).max(300),
  body: z.string().min(1).max(102400), // 100KB
  excerpt: z.string().max(500).optional(),
  featuredImage: safeUrl(true).max(FEATURED_IMAGE_MAX).optional(),
  section: z.enum(["NEWS", "OPINIONS", "LIONS_DEN", "A_AND_E", "FEATURES", "THE_ROUNDTABLE", "MD_ALUMNI"]),
  groupId: z.string().uuid(),
  credits: z
    .array(
      z.object({
        userId: z.string().uuid(),
        creditRole: z.string().min(1).max(50),
      })
    )
    .optional(),
  images: z
    .array(
      z.object({
        url: safeUrl(false),
        caption: z.string().optional(),
        altText: z.string().min(1),
        order: z.number().int().min(0),
      })
    )
    .optional(),
});

export const updateArticleSchema = createArticleSchema.partial();

export const listArticlesSchema = z.object({
  section: z.enum(["NEWS", "OPINIONS", "LIONS_DEN", "A_AND_E", "FEATURES", "THE_ROUNDTABLE", "MD_ALUMNI"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
});

export const uploadRequestSchema = z.object({
  filename: z.string().min(1),
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  contentLength: z.number().int().min(1).max(10 * 1024 * 1024), // 10MB
});

// Two accepted shapes:
//   - uploads/<uuid>.<ext>                   (legacy keys; uploader unknown — editor+ only to delete)
//   - uploads/<uploaderId>/<uuid>.<ext>      (new keys; uploader id encoded for ownership gating)
const UUID_RE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UPLOAD_KEY_PATTERN = new RegExp(
  `^uploads\\/(?:${UUID_RE}\\/)?${UUID_RE}\\.(jpg|jpeg|png|webp)$`,
);

export const deleteImageSchema = z.object({
  key: z
    .string()
    .regex(UPLOAD_KEY_PATTERN, "Invalid upload key"),
});

// Returns the uploader id encoded in a new-format key, or null for legacy keys.
export function uploaderIdFromKey(key: string): string | null {
  const match = key.match(new RegExp(`^uploads\\/(${UUID_RE})\\/${UUID_RE}\\.`));
  return match ? match[1]! : null;
}

// Issue PDF upload (presigned PUT to private S3 prefix). 50 MB cap. EDITOR+ only — auth gate
// is enforced in the route handler.
export const issuePdfUploadRequestSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.literal("application/pdf"),
  contentLength: z.number().int().min(1).max(50 * 1024 * 1024), // 50 MB
  groupId: z.string().uuid(),
});

const ISSUE_PDF_KEY_RE = new RegExp(
  `^issue-pdfs\\/(${UUID_RE})\\/${UUID_RE}\\.pdf$`,
);

// Returns the groupId encoded in an issue-pdf key, or null if the key doesn't match the
// expected shape. Use to reject swapped keys in setIssuePdf.
export function parseIssuePdfKey(key: string): { groupId: string } | null {
  const match = key.match(ISSUE_PDF_KEY_RE);
  return match ? { groupId: match[1]! } : null;
}

export const updateRoleSchema = z.object({
  role: z.enum(ALL_ROLES),
});

export const updateAdminSchema = z.object({
  isAdmin: z.boolean(),
});

export const directorySearchSchema = z.object({
  q: z.string().trim().min(1, "Query required").max(100),
});
