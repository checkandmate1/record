import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3 = new S3Client({
  region: process.env.AWS_REGION!,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
  // AWS SDK v3 (2025+) enables CRC32 checksum signing by default. That bakes a
  // x-amz-checksum-crc32 query param into presigned URLs which the browser PUT cannot satisfy
  // (it would need to compute and send the matching checksum header). Disabling makes presigned
  // PUTs work for plain `fetch(uploadUrl, { method: "PUT", body: file })`.
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});

const BUCKET = process.env.AWS_S3_BUCKET!;

export async function createPresignedUploadUrl(
  key: string,
  contentType: string,
  contentLength: number
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType,
    ContentLength: contentLength,
  });

  return getSignedUrl(s3, command, { expiresIn: 600 }); // 10 minutes
}

// Server-side upload. The browser path is always a presigned PUT (the server never sees image
// bytes); this exists for back-fill scripts that already hold the bytes — see
// scripts/migrate-featured-images-to-s3.ts.
export async function putS3Object(
  key: string,
  body: Buffer,
  contentType: string
): Promise<void> {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
  });

  await s3.send(command);
}

// The https URL for an object under the public-read `uploads/*` prefix. Mirrors the `publicUrl`
// POST /api/upload hands the browser, and the host rule `isS3Url` enforces.
export function getPublicUrl(key: string): string {
  return `https://${BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
}

export async function deleteS3Object(key: string): Promise<void> {
  const command = new DeleteObjectCommand({
    Bucket: BUCKET,
    Key: key,
  });

  await s3.send(command);
}

// Streams a private S3 object through the Next.js server. Used by the issue-PDF proxy route
// so the underlying S3 URL never reaches the client. Returns the readable body plus headers
// the route handler should forward to the browser.
export async function getS3ObjectStream(key: string): Promise<{
  body: ReadableStream<Uint8Array>;
  contentLength: number | undefined;
  contentType: string | undefined;
}> {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  const response = await s3.send(command);
  if (!response.Body) {
    throw new Error(`S3 object ${key} returned no body`);
  }
  // The AWS SDK v3 returns a Node Readable; transformToWebStream() converts to a WHATWG
  // ReadableStream<Uint8Array> that Next.js's Response can consume directly.
  const body = (response.Body as { transformToWebStream: () => ReadableStream<Uint8Array> })
    .transformToWebStream();
  return {
    body,
    contentLength: response.ContentLength,
    contentType: response.ContentType,
  };
}

// Reads only the first `length` bytes of an S3 object via a Range request. Used to verify
// magic bytes (e.g. "%PDF" for PDFs) post-upload before trusting client-asserted Content-Type.
export async function getS3ObjectHead(key: string, length: number): Promise<Buffer> {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Range: `bytes=0-${length - 1}`,
  });
  const response = await s3.send(command);
  if (!response.Body) {
    throw new Error(`S3 object ${key} returned no body for range request`);
  }
  const bytes = await (response.Body as { transformToByteArray: () => Promise<Uint8Array> })
    .transformToByteArray();
  return Buffer.from(bytes);
}
