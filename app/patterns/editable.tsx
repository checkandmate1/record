"use client";

import { useState, useRef, useEffect, useCallback, useTransition } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEditorContext } from "@/app/patterns/editor-context";
import { PopulatedSlot, SlotArticle } from "@/app/patterns/types";
import { parseCropRatio } from "@/app/patterns/crop";
import {
  assignToBlockSlot,
  assignMediaToBlockSlot,
  clearBlockSlot,
  clearSlotArticle,
  clearSlotMedia,
  updateSlotScale,
  updateSlotImageScale,
  updateSlotPreviewLength,
  toggleSlotFeatured,
  toggleSlotByline,
  updateImageFloat,
  updateImageWidth,
  updateImageCrop,
  updateMediaCredit,
  updateMediaAlt,
} from "@/app/dashboard/group-actions";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const SECTION_LABELS: Record<string, string> = {
  NEWS: "News",
  FEATURES: "Features",
  OPINIONS: "Opinions",
  A_AND_E: "A&E",
  LIONS_DEN: "Lion\u2019s Den",
  THE_ROUNDTABLE: "The Roundtable",
  MD_ALUMNI: "MD/Alumni",
};

// Re-exported from a server-safe module so server-component patterns can call them.
// The actual definitions live in app/patterns/placeholder.ts (no "use client").
export { PLACEHOLDER_BODY, getPlaceholderArticle } from "@/app/patterns/placeholder";

/* ------------------------------------------------------------------ */
/*  Slot mutations                                                     */
/* ------------------------------------------------------------------ */

/** Mirrors `MEDIA_TEXT_MAX` in app/dashboard/group-schemas.ts (the server rejects longer). */
const MEDIA_TEXT_MAX = 300;

/**
 * Runs one slot server action, the way `layout-builder.tsx`'s `run()` runs block
 * actions. Keep the two in step.
 *
 * Every slot action is gated (`requireDashboardRole` -> `requireGroupMutable` ->
 * a group-scoped write) and Zod-validated, so it throws for a WRITER touching a
 * published issue, for a slot outside the group, or for a bad value. Calling
 * them fire-and-forget turned that into an unhandled rejection plus a toolbar
 * that silently did nothing. This awaits the action, `router.refresh()`es so the
 * next click reads fresh slot props instead of the render-time snapshot, and
 * hands the message back for an inline `role="alert"` next to the control.
 */
function useSlotMutation() {
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const router = useRouter();
  // `busy` only flips on the next render, so two clicks dispatched in the same
  // tick would both read `false`. The ref flips synchronously and is the real
  // lock; `busy` just drives the disabled chrome.
  const inFlight = useRef(false);

  const run = useCallback(
    (fn: () => Promise<unknown>) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setError(null);
      startTransition(async () => {
        try {
          await fn();
          router.refresh();
        } catch (e) {
          setError(e instanceof Error ? e.message : "That change could not be saved.");
        } finally {
          inFlight.current = false;
        }
      });
    },
    [router],
  );

  const clearError = useCallback(() => setError(null), []);

  return { run, busy, error, clearError };
}

type RunSlotAction = ReturnType<typeof useSlotMutation>["run"];

/** Inline failure message for a slot control, rendered next to that control. */
function SlotError({
  message,
  onDismiss,
  className = "",
}: {
  message: string | null;
  onDismiss?: () => void;
  className?: string;
}) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className={`font-headline text-[10px] leading-snug text-maroon bg-white/95 border border-maroon/30 px-1.5 py-1 ${className}`}
    >
      {message}
      {onDismiss && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
          className="cursor-pointer ml-1.5 text-maroon/60 hover:text-maroon"
          aria-label="Dismiss error"
        >
          &times;
        </button>
      )}
    </p>
  );
}

/**
 * A slot field the user can nudge locally (drag a slider, type in a box) before
 * the server has confirmed it.
 *
 * `slot.<field>` stays the single source of truth: the local override only lives
 * between the first drag and the refreshed prop arriving, and is dropped the
 * moment the server value changes. Two copies of `useState(slot.imageWidth)`
 * used to drift apart — the popup slider moved one and `ResizableImage` rendered
 * the other, so a resize didn't show until a hard reload.
 */
function useTransientOverride<T>(serverValue: T): [T, (v: T) => void] {
  // The override is stored together with the server value it was made against.
  // Once the refreshed prop differs from that base the pair no longer matches
  // and the override is ignored — no effect, no stale copy to keep in sync.
  const [pending, setPending] = useState<{ base: T; value: T } | null>(null);
  const value = pending && pending.base === serverValue ? pending.value : serverValue;
  const setOverride = useCallback(
    (v: T) => setPending({ base: serverValue, value: v }),
    [serverValue],
  );
  return [value, setOverride];
}

/**
 * The slot whose image was just uploaded, so the settings popup can open on its
 * alt-text field. Module scope rather than component state because the uploader
 * (`EditableImagePlaceholder`) unmounts when the refresh lands and a different
 * component (`EditableImage`) renders in its place.
 *
 * Reading it is pure; it is cleared from an effect once the new image mounts.
 */
let altFocusSlotId: string | null = null;

/* ------------------------------------------------------------------ */
/*  CogButton                                                          */
/* ------------------------------------------------------------------ */

function CogButton({
  onClick,
  buttonRef,
  className = "",
}: {
  onClick: () => void;
  buttonRef?: React.RefObject<HTMLButtonElement | null>;
  className?: string;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onClick();
      }}
      className={`cursor-pointer bg-white/90 border border-ink/10 w-6 h-6 flex items-center justify-center text-caption hover:text-maroon transition-colors ${className}`}
      title="Slot settings"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
      </svg>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  ScaleRow (S/M/L/XL picker)                                         */
/* ------------------------------------------------------------------ */

function ScaleRow({
  label,
  current,
  onChange,
}: {
  label: string;
  current: string;
  onChange: (s: string) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="font-headline text-[12px] text-caption">{label}</span>
      <div className="flex border border-neutral-200">
        {["S", "M", "L", "XL"].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onChange(s)}
            className={`cursor-pointer px-2 py-1 font-headline text-[11px] transition-colors ${
              current === s ? "bg-ink text-white" : "text-caption hover:text-maroon"
            }`}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  CreditSearch                                                       */
/* ------------------------------------------------------------------ */

function CreditSearch({
  current,
  staffMembers,
  onSelect,
}: {
  current: string;
  staffMembers: { id: string; name: string }[];
  onSelect: (name: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered =
    query.length > 0
      ? staffMembers.filter((m) => m.name.toLowerCase().includes(query.toLowerCase()))
      : staffMembers;

  return (
    <div className="relative">
      <div className="flex items-center justify-between gap-2">
        <span className="font-headline text-[12px] text-caption">Credit</span>
        {current ? (
          <div className="flex items-center gap-1">
            <span className="font-headline text-[11px] text-maroon font-semibold">{current}</span>
            <button
              type="button"
              onClick={() => onSelect("")}
              className="cursor-pointer text-caption/40 hover:text-maroon transition-colors text-[13px] px-0.5"
            >
              &times;
            </button>
          </div>
        ) : (
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            placeholder="Search staff..."
            className="w-[120px] border border-neutral-200 px-2 py-0.5 font-headline text-[11px] tracking-wide placeholder:text-caption/30 outline-none focus:border-maroon"
          />
        )}
      </div>
      {open && !current && filtered.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-neutral-200 shadow-[0_4px_16px_rgba(0,0,0,0.08)] z-40 max-h-32 overflow-y-auto">
          {filtered.map((m) => (
            <button
              key={m.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onSelect(m.name);
                setQuery("");
                setOpen(false);
              }}
              className="cursor-pointer w-full text-left px-3 py-1.5 font-headline text-[11px] tracking-wide hover:bg-neutral-50 hover:text-maroon transition-colors"
            >
              {m.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  AltTextField                                                       */
/* ------------------------------------------------------------------ */

/**
 * Alt text for the slot's image. Uploads deliberately store `""` rather than the
 * filename — "IMG_4821.jpg" read aloud is worse than nothing — and this is where
 * a human writes a real description. Empty is a legitimate value: a purely
 * decorative image should stay `alt=""`.
 */
function AltTextField({
  slot,
  groupId,
  run,
  busy,
  autoFocus = false,
}: {
  slot: PopulatedSlot;
  groupId: string;
  run: RunSlotAction;
  busy: boolean;
  autoFocus?: boolean;
}) {
  const serverAlt = slot.mediaAlt ?? "";
  const [value, setValue] = useTransientOverride(serverAlt);
  const inputRef = useRef<HTMLInputElement>(null);
  const fieldId = `slot-alt-${slot.id}`;

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  function commit(next: string) {
    const trimmed = next.slice(0, MEDIA_TEXT_MAX);
    if (trimmed === serverAlt) return;
    run(() => updateMediaAlt(slot.id, trimmed, groupId));
  }

  return (
    <div className="flex items-center justify-between gap-2">
      <label htmlFor={fieldId} className="font-headline text-[12px] text-caption shrink-0">
        Alt text
      </label>
      <input
        id={fieldId}
        ref={inputRef}
        type="text"
        value={value}
        maxLength={MEDIA_TEXT_MAX}
        disabled={busy}
        onChange={(e) => setValue(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit((e.target as HTMLInputElement).value);
          }
        }}
        placeholder="Describe the image"
        className="w-[130px] border border-neutral-200 px-2 py-0.5 font-headline text-[11px] tracking-wide placeholder:text-caption/30 outline-none focus:border-maroon disabled:opacity-50"
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  SlotSettingsPopup                                                  */
/* ------------------------------------------------------------------ */

function SlotSettingsPopup({
  slot,
  groupId,
  pvLen,
  onPvLenChange,
  imgWidth,
  onImgWidthChange,
  staffMembers,
  anchorRef,
  onClose,
  autoFocusAlt = false,
}: {
  slot: PopulatedSlot;
  groupId: string;
  pvLen: number;
  onPvLenChange: (v: number) => void;
  imgWidth: number;
  onImgWidthChange: (w: number) => void;
  staffMembers: { id: string; name: string }[];
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  autoFocusAlt?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { run, busy, error, clearError } = useSlotMutation();
  const isHeadline = slot.slotRole === "headline";
  const isImageSlot = slot.slotRole === "image" || slot.slotRole === "media";
  const isArticleSlot = !isImageSlot;
  const hasImage = !!slot.mediaUrl || isImageSlot;
  const [showAdvancedCrop, setShowAdvancedCrop] = useState(false);
  const [customRatio, setCustomRatio] = useState(slot.imageCropCustom ?? "16:9");
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const reposition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const popH = ref.current?.offsetHeight ?? 300;
    const spaceBelow = window.innerHeight - r.bottom - 8;
    const top = spaceBelow >= popH ? r.bottom + 4 : Math.max(8, r.top - popH - 4);
    const left = Math.max(8, Math.min(r.right - 240, window.innerWidth - 252));
    setPos({ top, left });
  }, [anchorRef]);

  useEffect(() => {
    reposition();
  }, [reposition]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        ref.current &&
        !ref.current.contains(e.target as Node) &&
        !(anchorRef.current && anchorRef.current.contains(e.target as Node))
      ) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose, anchorRef]);

  function commitPvLen(v: number) {
    const clamped = Math.max(50, Math.min(500, v));
    onPvLenChange(clamped);
    run(() => updateSlotPreviewLength(slot.id, clamped, groupId));
  }

  function commitImgWidth(v: number) {
    const clamped = Math.max(10, Math.min(100, v));
    onImgWidthChange(clamped);
    run(() => updateImageWidth(slot.id, clamped, groupId));
  }

  return createPortal(
    <div
      ref={ref}
      className="fixed z-50 bg-white border border-neutral-200 shadow-lg rounded-sm p-3.5 space-y-3 min-w-[240px] max-h-[80vh] overflow-y-auto"
      style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}
      onClick={(e) => e.stopPropagation()}
    >
      <SlotError message={error} onDismiss={clearError} />

      {hasImage && (
        <>
          <div className="flex items-center justify-between">
            <span className="font-headline text-[12px] text-caption">Position</span>
            <div className="flex border border-neutral-200">
              {(["left", "full", "right"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => updateImageFloat(slot.id, f, groupId))}
                  className={`cursor-pointer px-2.5 py-1 font-headline text-[11px] transition-colors disabled:opacity-50 ${
                    (slot.imageFloat ?? "full") === f
                      ? "bg-ink text-white"
                      : "text-caption hover:text-maroon"
                  }`}
                >
                  {f === "left" ? "Left" : f === "right" ? "Right" : "Full"}
                </button>
              ))}
            </div>
          </div>

          {(slot.imageFloat ?? "full") !== "full" && (
            <div className="flex items-center justify-between gap-2">
              <span className="font-headline text-[12px] text-caption">Width</span>
              <div className="flex items-center gap-1.5">
                <span className="font-headline text-[11px] text-caption w-[28px] text-right">
                  {imgWidth}%
                </span>
                <input
                  type="range"
                  min="10"
                  max="80"
                  step="5"
                  value={imgWidth}
                  onChange={(e) => onImgWidthChange(parseInt(e.target.value, 10))}
                  onMouseUp={() => commitImgWidth(imgWidth)}
                  onTouchEnd={() => commitImgWidth(imgWidth)}
                  className="w-[80px] h-[12px] accent-maroon"
                />
              </div>
            </div>
          )}

          <ScaleRow
            label="Quick size"
            current={slot.imageScale ?? "M"}
            onChange={(s) => {
              const widthMap: Record<string, number> = { S: 25, M: 50, L: 75, XL: 100 };
              const newW = widthMap[s] ?? 50;
              onImgWidthChange(newW);
              // One `run` for the whole preset: the in-flight lock drops anything
              // dispatched while a mutation is running, so these must be awaited
              // in sequence rather than fired as three separate calls.
              run(async () => {
                await updateSlotImageScale(slot.id, s, groupId);
                await updateImageWidth(slot.id, newW, groupId);
                if (s === "XL") await updateImageFloat(slot.id, "full", groupId);
              });
            }}
          />

          <div className="flex items-center justify-between">
            <span className="font-headline text-[12px] text-caption">Crop</span>
            <div className="flex border border-neutral-200">
              {(["original", "landscape", "portrait", "square"] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => updateImageCrop(slot.id, c, null, groupId))}
                  className={`cursor-pointer px-1.5 py-1 font-headline text-[10px] transition-colors disabled:opacity-50 ${
                    (slot.imageCrop ?? "original") === c
                      ? "bg-ink text-white"
                      : "text-caption hover:text-maroon"
                  }`}
                >
                  {c === "original"
                    ? "Orig"
                    : c === "landscape"
                      ? "16:9"
                      : c === "portrait"
                        ? "3:4"
                        : "1:1"}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowAdvancedCrop(!showAdvancedCrop)}
            className="cursor-pointer font-headline text-[11px] text-caption/60 hover:text-maroon transition-colors"
          >
            {showAdvancedCrop ? "Hide advanced" : "Advanced crop..."}
          </button>
          {showAdvancedCrop && (
            <div className="flex items-center gap-1.5 pl-2">
              <span className="font-headline text-[11px] text-caption">Custom</span>
              <input
                type="text"
                value={customRatio}
                onChange={(e) => setCustomRatio(e.target.value)}
                placeholder="16:9"
                className="w-[48px] font-headline text-[11px] text-center border border-neutral-200 py-0.5 px-1 outline-none focus:border-maroon"
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => updateImageCrop(slot.id, "custom", customRatio, groupId))}
                className={`cursor-pointer font-headline text-[10px] px-2 py-0.5 border transition-colors disabled:opacity-50 ${
                  slot.imageCrop === "custom"
                    ? "border-maroon text-maroon bg-maroon/5"
                    : "border-neutral-200 text-caption hover:text-maroon"
                }`}
              >
                Apply
              </button>
            </div>
          )}

          <AltTextField
            slot={slot}
            groupId={groupId}
            run={run}
            busy={busy}
            autoFocus={autoFocusAlt}
          />

          <CreditSearch
            current={slot.mediaCredit ?? ""}
            staffMembers={staffMembers}
            onSelect={(name) => run(() => updateMediaCredit(slot.id, name, groupId))}
          />
        </>
      )}

      {isArticleSlot && (
        <>
          <ScaleRow
            label="Text size"
            current={slot.scale ?? "M"}
            onChange={(s) => run(() => updateSlotScale(slot.id, s, groupId))}
          />
          {!isHeadline && (
            <div className="flex items-center justify-between gap-2">
              <span className="font-headline text-[12px] text-caption">Preview length</span>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={50}
                  max={500}
                  step={10}
                  value={pvLen}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    if (!isNaN(v)) onPvLenChange(v);
                  }}
                  onBlur={(e) => {
                    const v = parseInt(e.target.value, 10);
                    if (!isNaN(v)) commitPvLen(v);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const v = parseInt((e.target as HTMLInputElement).value, 10);
                      if (!isNaN(v)) commitPvLen(v);
                    }
                  }}
                  className="w-[42px] font-headline text-[11px] text-center border border-neutral-200 py-0.5 px-0.5 outline-none focus:border-maroon"
                />
                <input
                  type="range"
                  min="50"
                  max="500"
                  step="10"
                  value={pvLen}
                  onChange={(e) => onPvLenChange(parseInt(e.target.value, 10))}
                  onMouseUp={() => commitPvLen(pvLen)}
                  onTouchEnd={() => commitPvLen(pvLen)}
                  className="w-[70px] h-[12px] accent-maroon"
                />
              </div>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="font-headline text-[12px] text-caption">Featured</span>
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => toggleSlotFeatured(slot.id, !slot.featured, groupId))}
              className={`cursor-pointer font-headline text-[11px] px-2.5 py-1 border transition-colors disabled:opacity-50 ${
                slot.featured
                  ? "border-maroon text-maroon bg-maroon/5"
                  : "border-neutral-200 text-caption hover:text-maroon"
              }`}
            >
              {slot.featured ? "On" : "Off"}
            </button>
          </div>
          {isHeadline && (
            <div className="flex items-center justify-between">
              <span className="font-headline text-[12px] text-caption">Show author</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => toggleSlotByline(slot.id, !slot.showByline, groupId))}
                className={`cursor-pointer font-headline text-[11px] px-2.5 py-1 border transition-colors disabled:opacity-50 ${
                  slot.showByline
                    ? "border-maroon text-maroon bg-maroon/5"
                    : "border-neutral-200 text-caption hover:text-maroon"
                }`}
              >
                {slot.showByline ? "On" : "Off"}
              </button>
            </div>
          )}
        </>
      )}
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ */
/*  SlotAssignPopup                                                    */
/* ------------------------------------------------------------------ */

function SlotAssignPopup({
  slotId,
  groupId,
  availableArticles,
  onClose,
}: {
  slotId: string;
  groupId: string;
  availableArticles: { id: string; title: string; section: string }[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { run, busy, error, clearError } = useSlotMutation();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  const filtered =
    query.length > 0
      ? availableArticles
          .filter((a) => a.title.toLowerCase().includes(query.toLowerCase()))
          .slice(0, 8)
      : availableArticles.slice(0, 8);

  function handleSelect(articleId: string) {
    // Close only once the assignment lands — if the action throws (published
    // issue, slot outside this group) the popup stays open with the reason.
    run(async () => {
      await assignToBlockSlot(slotId, articleId, groupId);
      onClose();
    });
  }

  return (
    <div
      ref={ref}
      className="absolute left-0 right-0 top-full mt-1 bg-white border border-neutral-200 shadow-[0_4px_16px_rgba(0,0,0,0.08)] z-30"
    >
      <SlotError message={error} onDismiss={clearError} className="m-2" />
      <div className="p-2 border-b border-neutral-100">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search articles..."
          className="w-full border border-ink/15 px-3 py-1.5 font-headline text-[13px] tracking-wide placeholder:text-caption/30 outline-none focus:border-ink transition-colors"
        />
      </div>
      <div className="max-h-48 overflow-y-auto">
        {filtered.length === 0 && (
          <p className="px-3 py-3 font-headline text-[12px] text-caption/50 text-center">
            No articles found
          </p>
        )}
        {filtered.map((a) => (
          <button
            key={a.id}
            type="button"
            disabled={busy}
            onClick={() => handleSelect(a.id)}
            className="cursor-pointer w-full text-left px-3 py-2 font-headline text-[13px] tracking-wide hover:bg-neutral-50 hover:text-maroon transition-colors flex items-baseline justify-between gap-2 disabled:opacity-50"
          >
            <span className="truncate">{a.title}</span>
            <span className="text-[11px] text-caption/50 shrink-0">
              {SECTION_LABELS[a.section] ?? a.section}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  MediaUploadPopup                                                   */
/* ------------------------------------------------------------------ */

function MediaUploadPopup({
  slotId,
  groupId,
  onClose,
}: {
  slotId: string;
  groupId: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [sizeError, setSizeError] = useState("");
  const router = useRouter();
  // Must match `uploadRequestSchema` in lib/validations.ts. Server rejects anything bigger or
  // any content type outside this list with a 400.
  const MAX_FILE_SIZE = 10 * 1024 * 1024;
  const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSizeError("");
    if (!ALLOWED_TYPES.has(file.type)) {
      setSizeError("File type must be JPEG, PNG, or WEBP");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setSizeError(`File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max is 10MB.`);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    const type = "image";

    try {
      // Step 1: ask the API for a presigned S3 URL.
      const presignRes = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type,
          contentLength: file.size,
        }),
      });
      if (!presignRes.ok) {
        const err = await presignRes.json().catch(() => ({}));
        setSizeError(err?.error?.message ?? "Upload failed (presign)");
        return;
      }
      const { uploadUrl, publicUrl } = await presignRes.json();

      // Step 2: upload the file directly to S3 with the presigned URL.
      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!putRes.ok) {
        setSizeError("Upload failed (S3)");
        return;
      }

      // Step 3: tell the server the slot now points at this URL. Alt text starts
      // empty on purpose — the filename ("IMG_4821.jpg") is not a description —
      // and the slot is flagged so the settings popup opens on the alt field.
      await assignMediaToBlockSlot(slotId, publicUrl, type, "", "", groupId);
      altFocusSlotId = slotId;
      onClose();
      router.refresh();
    } catch (err) {
      setSizeError(`Upload failed: ${(err as Error).message}`);
    }
  }

  return (
    <div
      ref={ref}
      className="absolute left-0 right-0 top-full mt-1 bg-white border border-neutral-200 shadow-[0_4px_16px_rgba(0,0,0,0.08)] z-30 p-3"
    >
      <p className="font-headline text-[12px] font-semibold tracking-wide mb-2">Upload media</p>
      <label className="cursor-pointer block w-full border border-dashed border-neutral-300 bg-neutral-50 hover:bg-neutral-100 hover:border-ink/40 transition-colors py-6 px-4 text-center">
        <span className="font-headline text-[12px] tracking-wide text-ink/70 block">
          Click to choose a file
        </span>
        <span className="font-headline text-[10px] tracking-wide text-caption/50 block mt-1">
          JPEG, PNG, or WEBP &middot; max 10MB
        </span>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleFile}
          className="hidden"
        />
      </label>
      <SlotError message={sizeError || null} className="mt-1.5" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ResizableImage — drag-to-resize for floated images                 */
/* ------------------------------------------------------------------ */

function ResizableImage({
  src,
  alt,
  credit,
  imageFloat,
  imageWidth,
  cropRatio,
  onWidthChange,
  onWidthCommit,
}: {
  src: string;
  alt: string;
  credit: string | null;
  imageFloat: string;
  imageWidth: number;
  cropRatio: number | null;
  onWidthChange: (w: number) => void;
  onWidthCommit: (w: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const startW = useRef(0);

  function handlePointerDown(e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
    startX.current = e.clientX;
    startW.current = imageWidth;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!dragging || !containerRef.current) return;
    const parentW = containerRef.current.parentElement?.clientWidth ?? 400;
    const deltaPx = e.clientX - startX.current;
    const sign = imageFloat === "right" ? -1 : 1;
    const deltaPct = (deltaPx / parentW) * 100 * sign;
    const newW = Math.max(10, Math.min(100, Math.round(startW.current + deltaPct)));
    onWidthChange(newW);
  }

  function handlePointerUp() {
    if (!dragging) return;
    setDragging(false);
    onWidthCommit(imageWidth);
  }

  const floatClass =
    imageFloat === "left" ? "float-left mr-3 mb-2" : imageFloat === "right" ? "float-right ml-3 mb-2" : "";

  return (
    <div
      ref={containerRef}
      className={`relative group/resize ${floatClass}`}
      style={{
        width: imageFloat === "full" ? "100%" : `${imageWidth}%`,
        ...(cropRatio ? { aspectRatio: String(cropRatio) } : {}),
      }}
    >
      <img
        src={src}
        alt={alt}
        className="w-full h-full bg-neutral-100"
        style={{ objectFit: cropRatio ? "cover" : "contain" }}
        draggable={false}
      />
      {credit && (
        <span className="absolute bottom-1 right-1 font-headline text-[9px] text-white/80 bg-black/40 px-1.5 py-0.5">
          {credit}
        </span>
      )}
      {imageFloat !== "full" && (
        <span
          className={`absolute bottom-1 font-headline text-[9px] bg-white/90 border border-ink/10 px-1 py-0.5 text-caption transition-opacity ${
            imageFloat === "right" ? "left-5" : "right-5"
          } ${dragging ? "opacity-100" : "opacity-0 group-hover/resize:opacity-100"}`}
        >
          {imageWidth}%
        </span>
      )}
      {imageFloat !== "full" && (
        <div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          className={`absolute bottom-0 w-6 h-6 cursor-${
            imageFloat === "right" ? "nesw" : "nwse"
          }-resize flex items-center justify-center transition-opacity ${
            imageFloat === "right" ? "left-0" : "right-0"
          } ${dragging ? "opacity-100" : "opacity-0 group-hover/resize:opacity-100"}`}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" className="text-maroon/70">
            <path
              d={
                imageFloat === "right"
                  ? "M0 10L10 0M0 6L6 0M0 2L2 0"
                  : "M10 10L0 0M10 6L4 0M10 2L8 0"
              }
              stroke="currentColor"
              strokeWidth="1.5"
              fill="none"
            />
          </svg>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  EditableSlot — wraps article content with edit chrome              */
/* ------------------------------------------------------------------ */

/**
 * Wraps the rendered article content of a slot with edit-mode chrome:
 * - Empty slot: shows children as a faded placeholder + click-to-assign
 * - Filled slot: shows children + hover overlay (cog/delete) + popups
 *
 * In live mode (no editor context), simply renders children if the slot has
 * an article — or null if empty (so empty positions disappear from layout).
 */
export function EditableSlot({
  slot,
  children,
}: {
  slot: PopulatedSlot | undefined;
  children: React.ReactNode;
}) {
  const ctx = useEditorContext();
  const inEditMode = ctx !== null;
  const [popupType, setPopupType] = useState<"article" | "settings" | null>(null);
  const cogRef = useRef<HTMLButtonElement>(null);
  // Derived from the slot, not copied into state: the popup slider and the
  // rendered image must agree, and both must follow the refreshed server value.
  const [pvLen, setPvLen] = useTransientOverride(Number(slot?.previewLength) || 200);
  const [imgWidth, setImgWidth] = useTransientOverride(slot?.imageWidth ?? 100);
  const { run, busy, error, clearError } = useSlotMutation();

  if (!inEditMode) {
    if (!slot?.article) return null;
    return <>{children}</>;
  }

  if (!slot) return null;

  const hasArticle = !!slot.article;

  if (!hasArticle) {
    // Use a div (not button) because children may contain <a>/<Link>, which is
    // invalid inside <button>. The capture handler at the editor root prevents
    // those links from navigating, so we just need a click handler here.
    return (
      <div className="relative">
        <div
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            setPopupType(popupType === "article" ? null : "article");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setPopupType(popupType === "article" ? null : "article");
            }
          }}
          className="cursor-pointer block w-full transition-all hover:outline hover:outline-2 hover:outline-maroon/40 hover:bg-maroon/5 rounded-sm"
          style={{ opacity: ctx.placeholderOpacity }}
        >
          {children}
        </div>
        {popupType === "article" && (
          <SlotAssignPopup
            slotId={slot.id}
            groupId={ctx.groupId}
            availableArticles={ctx.availableArticles}
            onClose={() => setPopupType(null)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="relative group/slot">
      {children}
      <div className="absolute -top-1 -right-1 flex items-center gap-0.5 opacity-0 group-hover/slot:opacity-100 transition-opacity z-20">
        <CogButton
          buttonRef={cogRef}
          onClick={() => setPopupType(popupType === "settings" ? null : "settings")}
        />
        <button
          type="button"
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            run(() => clearSlotArticle(slot.id, ctx.groupId));
          }}
          className="cursor-pointer bg-white/90 border border-ink/10 w-6 h-6 flex items-center justify-center text-caption hover:text-maroon transition-colors text-[13px] disabled:opacity-50"
        >
          &times;
        </button>
      </div>
      <SlotError
        message={error}
        onDismiss={clearError}
        className="absolute top-full left-0 right-0 mt-1 z-30"
      />
      {popupType === "settings" && (
        <SlotSettingsPopup
          slot={slot}
          groupId={ctx.groupId}
          pvLen={pvLen}
          onPvLenChange={setPvLen}
          imgWidth={imgWidth}
          onImgWidthChange={setImgWidth}
          staffMembers={ctx.staffMembers}
          anchorRef={cogRef}
          onClose={() => setPopupType(null)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  EditableImage — wraps an image with edit chrome                    */
/* ------------------------------------------------------------------ */

/**
 * Wraps an `<img>` with edit-mode chrome:
 * - Filled: hover overlay with cog (settings) + delete (clears media)
 * - Drag handles for floated images
 *
 * In live mode, renders just `<img>` (optionally wrapped in a Link) with the
 * given `imgClassName` and `imgStyle`. The optional `href` is used as the
 * navigation target — in edit mode, the link wrapper is suppressed so that
 * buttons inside the chrome are not nested inside an `<a>`.
 */
export function EditableImage({
  slot,
  src,
  alt,
  imgClassName,
  imgStyle,
  wrapperClassName,
  wrapperStyle,
  credit,
  href,
}: {
  slot: PopulatedSlot;
  src: string;
  alt: string;
  imgClassName?: string;
  imgStyle?: React.CSSProperties;
  wrapperClassName?: string;
  wrapperStyle?: React.CSSProperties;
  credit?: string | null;
  href?: string;
}) {
  const ctx = useEditorContext();
  const inEditMode = ctx !== null;
  // Freshly uploaded image: open the settings popup on the alt-text field so the
  // uploader writes a description instead of shipping the image without one.
  const [popupType, setPopupType] = useState<"settings" | null>(() =>
    altFocusSlotId === slot.id ? "settings" : null,
  );
  const [focusAlt, setFocusAlt] = useState(() => altFocusSlotId === slot.id);
  const cogRef = useRef<HTMLButtonElement>(null);
  // `slot.imageWidth` is the source of truth; the setter is only a transient
  // override for the drag in progress, dropped as soon as the server value lands.
  const [pvLen, setPvLen] = useTransientOverride(Number(slot.previewLength) || 200);
  const [imgWidth, setImgWidth] = useTransientOverride(slot.imageWidth ?? 100);
  const { run, busy, error, clearError } = useSlotMutation();
  const cropRatio = parseCropRatio(slot.imageCrop, slot.imageCropCustom);

  // The hand-off is one-shot: clear it now that this image has mounted, so a
  // later refresh doesn't reopen the popup.
  useEffect(() => {
    if (altFocusSlotId === slot.id) altFocusSlotId = null;
  }, [slot.id]);
  const isMediaSlot = slot.slotRole === "image" || slot.slotRole === "media";
  const displayCredit = credit ?? slot.mediaCredit ?? null;

  if (!inEditMode) {
    const imgEl = (
      <>
        <img src={src} alt={alt} className={imgClassName} style={imgStyle} />
        {displayCredit && (
          <span className="absolute bottom-1 right-1 font-headline text-[10px] text-white/80 bg-black/40 px-1.5 py-0.5">
            {displayCredit}
          </span>
        )}
      </>
    );
    if (href) {
      return (
        <Link
          href={href}
          className={`block relative ${wrapperClassName ?? ""}`}
          style={wrapperStyle}
        >
          {imgEl}
        </Link>
      );
    }
    return (
      <div className={`relative ${wrapperClassName ?? ""}`} style={wrapperStyle}>
        {imgEl}
      </div>
    );
  }

  const isFloated = slot.imageFloat === "left" || slot.imageFloat === "right";

  if (isFloated) {
    return (
      <div className="relative group/slot">
        <ResizableImage
          src={src}
          alt={alt}
          credit={displayCredit}
          imageFloat={slot.imageFloat ?? "full"}
          imageWidth={imgWidth}
          cropRatio={cropRatio}
          onWidthChange={setImgWidth}
          onWidthCommit={(w) => run(() => updateImageWidth(slot.id, w, ctx.groupId))}
        />
        <div className="absolute top-1 right-1 flex items-center gap-0.5 opacity-0 group-hover/slot:opacity-100 transition-opacity z-20">
          <CogButton
            buttonRef={cogRef}
            onClick={() => setPopupType(popupType === "settings" ? null : "settings")}
          />
          <button
            type="button"
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              run(() =>
                isMediaSlot
                  ? clearBlockSlot(slot.id, ctx.groupId)
                  : clearSlotMedia(slot.id, ctx.groupId),
              );
            }}
            className="cursor-pointer bg-white/90 border border-ink/10 w-6 h-6 flex items-center justify-center text-caption hover:text-maroon transition-colors text-[13px] disabled:opacity-50"
          >
            &times;
          </button>
        </div>
        <SlotError
          message={error}
          onDismiss={clearError}
          className="absolute top-full left-0 right-0 mt-1 z-30"
        />
        {popupType === "settings" && (
          <SlotSettingsPopup
            slot={slot}
            groupId={ctx.groupId}
            pvLen={pvLen}
            onPvLenChange={setPvLen}
            imgWidth={imgWidth}
            onImgWidthChange={setImgWidth}
            staffMembers={ctx.staffMembers}
            anchorRef={cogRef}
            autoFocusAlt={focusAlt}
            onClose={() => {
              setPopupType(null);
              setFocusAlt(false);
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div
      className={`relative group/slot ${wrapperClassName ?? ""}`}
      style={wrapperStyle}
    >
      <img src={src} alt={alt} className={imgClassName} style={imgStyle} draggable={false} />
      {displayCredit && (
        <span className="absolute bottom-1 right-1 font-headline text-[10px] text-white/80 bg-black/40 px-1.5 py-0.5">
          {displayCredit}
        </span>
      )}
      <div className="absolute top-1 right-1 flex items-center gap-0.5 opacity-0 group-hover/slot:opacity-100 transition-opacity z-20">
        <CogButton
          buttonRef={cogRef}
          onClick={() => setPopupType(popupType === "settings" ? null : "settings")}
        />
        <button
          type="button"
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            run(() =>
              isMediaSlot
                ? clearBlockSlot(slot.id, ctx.groupId)
                : clearSlotMedia(slot.id, ctx.groupId),
            );
          }}
          className="cursor-pointer bg-white/90 border border-ink/10 w-6 h-6 flex items-center justify-center text-caption hover:text-maroon transition-colors text-[13px] disabled:opacity-50"
        >
          &times;
        </button>
      </div>
      <SlotError
        message={error}
        onDismiss={clearError}
        className="absolute top-full left-0 right-0 mt-1 z-30"
      />
      {popupType === "settings" && (
        <SlotSettingsPopup
          slot={slot}
          groupId={ctx.groupId}
          pvLen={pvLen}
          onPvLenChange={setPvLen}
          imgWidth={imgWidth}
          onImgWidthChange={setImgWidth}
          staffMembers={ctx.staffMembers}
          anchorRef={cogRef}
          autoFocusAlt={focusAlt}
          onClose={() => {
            setPopupType(null);
            setFocusAlt(false);
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  EditableImagePlaceholder — empty image upload box                  */
/* ------------------------------------------------------------------ */

/**
 * Renders nothing in live mode. In edit mode, renders an "+ img" button that
 * opens the media upload popup.
 */
export function EditableImagePlaceholder({
  slot,
  className = "",
  style,
  label = "+ img",
}: {
  slot: PopulatedSlot | undefined;
  className?: string;
  style?: React.CSSProperties;
  label?: string;
}) {
  const ctx = useEditorContext();
  const [popupOpen, setPopupOpen] = useState(false);

  if (!ctx || !slot) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setPopupOpen(!popupOpen)}
        className={`cursor-pointer bg-neutral-200 hover:bg-neutral-300 transition-colors flex items-center justify-center ${className}`}
        style={style}
      >
        <span className="font-headline text-[11px] text-neutral-400">{label}</span>
      </button>
      {popupOpen && (
        <MediaUploadPopup
          slotId={slot.id}
          groupId={ctx.groupId}
          onClose={() => setPopupOpen(false)}
        />
      )}
    </div>
  );
}
