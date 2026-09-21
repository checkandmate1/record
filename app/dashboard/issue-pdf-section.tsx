"use client";

import { useId, useRef, useState, useTransition } from "react";
import { setIssuePdf, removeIssuePdf } from "@/app/dashboard/group-actions";

const MAX_PDF_BYTES = 50 * 1024 * 1024;

interface IssuePdfSectionProps {
  groupId: string;
  hasPdf: boolean;
  pdfFilename: string | null;
  pdfByteSize: number | null;
  pdfUploadedAt: Date | null;
  canManage: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDateShort(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function IssuePdfSection(props: IssuePdfSectionProps) {
  const { groupId, hasPdf, pdfFilename, pdfByteSize, pdfUploadedAt, canManage } = props;

  const fileRef = useRef<HTMLInputElement>(null);
  const fileInputId = useId();
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [, startTransition] = useTransition();

  async function handleFile(file: File): Promise<void> {
    setError(null);
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setError("File must be a PDF.");
      return;
    }
    if (file.size > MAX_PDF_BYTES) {
      setError(`File too large (${formatBytes(file.size)}). Max 50 MB.`);
      return;
    }

    setUploading(true);
    try {
      // 1. Presigned PUT URL
      const presignRes = await fetch("/api/upload/issue-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          contentType: "application/pdf",
          contentLength: file.size,
          groupId,
        }),
      });
      if (!presignRes.ok) {
        const err = await presignRes.json().catch(() => ({}));
        setError(err?.error?.message ?? "Upload failed (presign)");
        return;
      }
      const { uploadUrl, key } = (await presignRes.json()) as { uploadUrl: string; key: string };

      // 2. PUT to S3
      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/pdf" },
        body: file,
      });
      if (!putRes.ok) {
        setError("Upload failed (S3)");
        return;
      }

      // 3. Server action: magic-byte check + DB write + replace-and-delete-old
      await setIssuePdf(groupId, key, file.name, file.size);

      // Clear the file input so the same filename can be re-selected if needed
      if (fileRef.current) fileRef.current.value = "";
    } catch (e) {
      setError(`Upload failed: ${(e as Error).message}`);
    } finally {
      setUploading(false);
    }
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
  }

  function onRemove(): void {
    if (!confirm("Remove this issue's PDF? The file will be deleted.")) return;
    startTransition(async () => {
      try {
        await removeIssuePdf(groupId);
      } catch (e) {
        setError(`Remove failed: ${(e as Error).message}`);
      }
    });
  }

  const sizeLabel = pdfByteSize != null ? formatBytes(pdfByteSize) : null;
  const dateLabel = pdfUploadedAt ? formatDateShort(pdfUploadedAt) : null;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-headline text-[20px] font-bold tracking-wide">PDF</h3>
      </div>

      {hasPdf ? (
        <div className="flex items-center justify-between gap-3 border border-ink/10 px-3 py-2.5">
          <div className="min-w-0">
            <p className="font-headline text-[14px] font-semibold truncate">
              {pdfFilename ?? "issue.pdf"}
            </p>
            <p className="font-headline text-[12px] text-caption mt-0.5">
              {[sizeLabel, dateLabel ? `uploaded ${dateLabel}` : null].filter(Boolean).join(" · ")}
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <a
              href={`/api/issues/${groupId}/pdf`}
              target="_blank"
              rel="noopener"
              className="font-headline text-[12px] font-bold tracking-wide text-maroon hover:underline"
            >
              View
            </a>
            {canManage && (
              <>
                {/* The styled <label> is the visible control; the input stays
                    sr-only (not `hidden`) so it is still keyboard-reachable. */}
                <input
                  id={fileInputId}
                  ref={fileRef}
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={onPick}
                  disabled={uploading}
                  className="sr-only peer"
                />
                <label
                  htmlFor={fileInputId}
                  className="cursor-pointer font-headline text-[12px] font-bold tracking-wide text-ink hover:text-maroon transition-colors peer-focus-visible:underline peer-focus-visible:text-maroon"
                >
                  Replace
                </label>
                <button
                  type="button"
                  onClick={onRemove}
                  disabled={uploading}
                  className="cursor-pointer font-headline text-[12px] font-bold tracking-wide text-caption hover:text-maroon transition-colors disabled:opacity-50"
                >
                  Remove
                </button>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3 border border-dashed border-ink/15 px-3 py-3">
          <p className="font-headline text-[13px] text-caption italic">
            No PDF attached.
          </p>
          {canManage && (
            <>
              <input
                id={fileInputId}
                ref={fileRef}
                type="file"
                accept="application/pdf,.pdf"
                onChange={onPick}
                disabled={uploading}
                className="sr-only peer"
              />
              <label
                htmlFor={fileInputId}
                className="cursor-pointer font-headline font-bold text-[13px] tracking-wide bg-ink text-white px-4 py-2 hover:bg-maroon transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-maroon"
              >
                {uploading ? "Uploading…" : "Upload PDF"}
              </label>
            </>
          )}
        </div>
      )}

      {uploading && (
        <p className="mt-2 font-headline text-[12px] text-caption">
          Uploading… large PDFs can take a moment on slow connections.
        </p>
      )}
      {error && (
        <p className="mt-2 font-headline text-[12px] text-maroon">{error}</p>
      )}
    </div>
  );
}
