"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { isDashboardRole } from "@/lib/roles";

const SECTIONS = [
  { label: "News", href: "/section/news" },
  { label: "Features", href: "/section/features" },
  { label: "Opinions", href: "/section/opinions" },
  { label: "A&E", href: "/section/a-and-e" },
  { label: "Lion\u2019s Den", href: "/section/lions-den" },
  { label: "MD/Alumni", href: "/section/md-alumni" },
];

export function HamburgerButton({
  isAuthenticated = false,
  userRole,
}: {
  isAuthenticated?: boolean;
  userRole?: string;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Escape closes the drawer and hands focus back to the hamburger.
  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  // Opening the drawer moves focus into it, so the next Tab lands on the menu.
  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  const pages: { label: string; href: string }[] = [{ label: "Home", href: "/" }];
  if (isAuthenticated) {
    if (isDashboardRole(userRole)) {
      pages.push({ label: "Dashboard", href: "/dashboard" });
    }
    pages.push({ label: "Account", href: "/account" });
  } else {
    pages.push({ label: "Sign In", href: "/login" });
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label="Open menu"
        aria-expanded={open}
        aria-controls={menuId}
        className="p-1 cursor-pointer"
        onClick={() => setOpen(true)}
      >
        <svg
          width="22"
          height="16"
          viewBox="0 0 22 16"
          fill="none"
          aria-hidden="true"
        >
          <line y1="1" x2="22" y2="1" stroke="currentColor" strokeWidth="2" />
          <line y1="8" x2="22" y2="8" stroke="currentColor" strokeWidth="2" />
          <line y1="15" x2="22" y2="15" stroke="currentColor" strokeWidth="2" />
        </svg>
      </button>

      {/* Backdrop — fades in/out */}
      <div
        aria-hidden="true"
        className={`fixed inset-0 bg-black/20 z-40 transition-opacity duration-300 ${
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={close}
      />

      {/* Slide-out panel */}
      <nav
        id={menuId}
        aria-label="Site menu"
        // A closed drawer keeps its slide transition but must not be reachable
        // by Tab or announced by a screen reader.
        inert={!open}
        className={`fixed top-0 left-0 h-full w-72 bg-white z-50 shadow-[4px_0_24px_rgba(0,0,0,0.08)] transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Close button */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-ink/10">
          <span className="font-masthead text-[24px] leading-none">
            The Record
          </span>
          <button
            ref={closeRef}
            type="button"
            aria-label="Close menu"
            className="cursor-pointer p-1 hover:text-maroon transition-colors"
            onClick={close}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Sections */}
        <div className="px-6 pt-6">
          <p
            className={`text-[11px] tracking-[0.12em] uppercase text-caption font-headline font-semibold mb-3 transition-all duration-300 ${
              open ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-3"
            }`}
            style={{ transitionDelay: open ? "150ms" : "0ms" }}
          >
            Sections
          </p>
          {SECTIONS.map((s, i) => (
            <Link
              key={s.href}
              href={s.href}
              onClick={() => setOpen(false)}
              className={`block py-2.5 font-headline text-[18px] tracking-wide hover:text-maroon transition-all duration-300 ${
                open ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-3"
              }`}
              style={{ transitionDelay: open ? `${180 + i * 40}ms` : "0ms" }}
            >
              {s.label}
            </Link>
          ))}
        </div>

        <div
          className={`mx-6 my-5 h-px bg-ink/10 transition-all duration-300 origin-left ${
            open ? "scale-x-100 opacity-100" : "scale-x-0 opacity-0"
          }`}
          style={{ transitionDelay: open ? "400ms" : "0ms" }}
        />

        {/* Pages */}
        <div className="px-6">
          {pages.map((p, i) => (
            <Link
              key={p.href}
              href={p.href}
              onClick={() => setOpen(false)}
              className={`block py-2.5 font-headline text-[16px] tracking-wide text-caption hover:text-maroon transition-all duration-300 ${
                open ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-3"
              }`}
              style={{ transitionDelay: open ? `${440 + i * 40}ms` : "0ms" }}
            >
              {p.label}
            </Link>
          ))}
        </div>
      </nav>
    </>
  );
}
