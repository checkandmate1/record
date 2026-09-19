"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

/**
 * Accessible modal primitive.
 *
 * Owns exactly the four things a hand-rolled popup always forgets:
 *   1. `role="dialog"` + `aria-modal` + an accessible name,
 *   2. focus moves into the dialog on open and back to the trigger on close,
 *   3. Tab / Shift+Tab are trapped inside the dialog,
 *   4. Escape and a backdrop click both call `onClose`.
 *
 * It deliberately ships no visual styling: the caller passes Tailwind classes
 * for position, size and animation via `className` / `backdropClassName`.
 */

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  'input:not([disabled]):not([type="hidden"])',
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "[contenteditable]",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((el) => !el.hasAttribute("hidden") && !el.closest("[hidden]"));
}

export interface DialogProps {
  /** Render and focus-trap the dialog. Closed dialogs render nothing at all. */
  open: boolean;
  /** Called on Escape, on a backdrop click, and by the caller's own controls. */
  onClose: () => void;
  /** Id of the element (usually the dialog's heading) that names the dialog. */
  labelledBy?: string;
  /** Fallback accessible name when there is no visible heading to point at. */
  label?: string;
  /** Tailwind classes for the dialog panel (position, size, background…). */
  className?: string;
  /** Tailwind classes for the backdrop. */
  backdropClassName?: string;
  /** Render into `document.body` (default) or in place. */
  portal?: boolean;
  /** Render the click-to-close backdrop (default `true`). */
  backdrop?: boolean;
  /** Lock `body` scrolling while open (default `true`). */
  lockScroll?: boolean;
  children: ReactNode;
}

export function Dialog({
  open,
  onClose,
  labelledBy,
  label,
  className = "",
  backdropClassName = "",
  portal = true,
  backdrop = true,
  lockScroll = true,
  children,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Move focus into the dialog on open; hand it back to the trigger on close.
  useEffect(() => {
    if (!open || !mounted) return;
    restoreRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const panel = panelRef.current;
    if (panel) {
      const first = focusableWithin(panel)[0];
      (first ?? panel).focus();
    }
    return () => {
      const trigger = restoreRef.current;
      restoreRef.current = null;
      if (trigger && document.contains(trigger)) trigger.focus();
    };
  }, [open, mounted]);

  useEffect(() => {
    if (!open || !lockScroll) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open, lockScroll]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const items = focusableWithin(panel);
      const active =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      if (items.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const inside = active !== null && panel.contains(active);
      if (e.shiftKey) {
        if (!inside || active === first) {
          e.preventDefault();
          last.focus();
        }
      } else if (!inside || active === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open, onKeyDown]);

  if (!open || (portal && !mounted)) return null;

  const content = (
    <>
      {backdrop && (
        <div
          className={backdropClassName}
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : label}
        tabIndex={-1}
        className={`outline-none ${className}`}
      >
        {children}
      </div>
    </>
  );

  return portal ? createPortal(content, document.body) : content;
}
