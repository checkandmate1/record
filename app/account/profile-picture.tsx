"use client";

import { useRef, useState } from "react";
import { updateProfilePicture, resetProfilePicture } from "@/app/account/account-actions";

const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp"];
const PROFILE_IMAGE_MAX_CHARS = 1_000_000;

export function ProfilePicture({
  userId,
  currentImage,
  googleImage,
  firstInitial,
}: {
  userId: string;
  currentImage: string | null;
  googleImage: string | null;
  firstInitial: string;
}) {
  const [image, setImage] = useState(currentImage);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const isCustom = googleImage && image !== googleImage;

  async function handleFile(file: File) {
    // Must match profilePictureSchema in lib/validations.ts: PNG/JPEG/WebP, data URL ≤ 1 MB.
    if (!ALLOWED_TYPES.includes(file.type)) {
      alert("Please choose a PNG, JPEG or WebP image.");
      return;
    }

    setUploading(true);
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      if (dataUrl.length > PROFILE_IMAGE_MAX_CHARS) {
        alert("That image is too large. Please choose a file under about 700 KB.");
        setUploading(false);
        return;
      }
      await updateProfilePicture(userId, dataUrl);
      setImage(dataUrl);
      setUploading(false);
    };
    reader.readAsDataURL(file);
  }

  async function handleReset() {
    if (!confirm("Reset your profile picture to your Google account photo?")) return;
    if (!googleImage) return;
    setUploading(true);
    // The server reads the stored googleImage itself; it no longer accepts a URL from here.
    await resetProfilePicture(userId);
    setImage(googleImage);
    setUploading(false);
  }

  return (
    <div className="shrink-0">
      <div className="relative group">
        {image ? (
          <img
            src={image}
            alt="Profile picture"
            className="w-16 h-16 object-cover bg-neutral-100"
          />
        ) : (
          <div className="w-16 h-16 bg-maroon text-white flex items-center justify-center font-headline font-bold text-[24px]">
            {firstInitial}
          </div>
        )}

        {/* Hover overlay */}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          aria-label={uploading ? "Uploading profile picture" : "Change profile picture"}
          className="cursor-pointer absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center"
        >
          <span className="text-white text-[11px] font-headline font-semibold tracking-wide uppercase opacity-0 group-hover:opacity-100 transition-opacity">
            {uploading ? "..." : "Edit"}
          </span>
        </button>

        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          aria-label="Profile picture file"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
      </div>

      {isCustom && (
        <button
          type="button"
          onClick={handleReset}
          aria-label="Reset profile picture to the Google account photo"
          className="cursor-pointer mt-2 font-headline text-[12px] tracking-wide text-caption/50 hover:text-maroon transition-colors"
        >
          Reset
        </button>
      )}
    </div>
  );
}
