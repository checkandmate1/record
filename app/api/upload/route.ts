import { NextRequest, NextResponse } from "next/server";
import { checkRole } from "@/lib/middleware/auth";
import { uploadRequestSchema, deleteImageSchema, uploaderIdFromKey } from "@/lib/validations";
import { createPresignedUploadUrl, deleteS3Object } from "@/lib/s3";
import { errorResponse } from "@/lib/errors";
import { randomUUID } from "crypto";
import { isEditorRole } from "@/lib/roles";

export async function POST(req: NextRequest) {
  const { session, error } = await checkRole("WRITER");
  if (error) return error;

  const body = await req.json();
  const parsed = uploadRequestSchema.safeParse(body);

  if (!parsed.success) {
    return errorResponse("BAD_REQUEST", parsed.error.issues[0].message);
  }

  const { filename, contentType, contentLength } = parsed.data;
  const ext = filename.split(".").pop()?.toLowerCase();
  const ALLOWED_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];
  if (!ext || !ALLOWED_EXTENSIONS.includes(ext)) {
    return errorResponse("BAD_REQUEST", "File extension must be jpg, jpeg, png, or webp");
  }
  // Encode uploader id in the path so DELETE can authorize without a separate ownership table.
  const key = `uploads/${session.user.id}/${randomUUID()}.${ext}`;

  const uploadUrl = await createPresignedUploadUrl(key, contentType, contentLength);

  return NextResponse.json({
    uploadUrl,
    key,
    publicUrl: `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`,
  });
}

export async function DELETE(req: NextRequest) {
  const { session, error } = await checkRole("WRITER");
  if (error) return error;

  const body = await req.json();
  const parsed = deleteImageSchema.safeParse(body);

  if (!parsed.success) {
    return errorResponse("BAD_REQUEST", parsed.error.issues[0].message);
  }

  // Ownership-or-editor gate. New-format keys carry the uploader id; legacy-format keys (no uploader)
  // require editor+ since we can't tell who put them there.
  const isEditorPlus = isEditorRole(session.user.role);
  const uploaderId = uploaderIdFromKey(parsed.data.key);
  const isOwner = uploaderId !== null && uploaderId === session.user.id;
  if (!isEditorPlus && !isOwner) {
    return errorResponse("FORBIDDEN", "You can only delete images you uploaded", 403);
  }

  await deleteS3Object(parsed.data.key);

  return NextResponse.json({ message: "Image deleted" });
}
