"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { signOutAction } from "@/app/sign-out-action";
import { isDashboardRole, isAdminRole, roleLabel } from "@/lib/roles";

interface AccountDropdownProps {
  userName: string | null | undefined;
  userEmail: string | null | undefined;
  userImage: string | null | undefined;
  userRole: string;
}

export function AccountDropdown({
  userName,
  userEmail,
  userImage,
  userRole,
}: AccountDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const firstInitial = userName?.charAt(0)?.toUpperCase() ?? "?";
  const displayRole = roleLabel(userRole);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="cursor-pointer flex items-center gap-2 font-headline tracking-wide transition-colors hover:text-maroon"
      >
        <span className="hidden md:inline">{userName ?? "Account"}</span>
        <span
          className={`text-[10px] align-middle inline-block transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        >
          &#9662;
        </span>
      </button>

      <div
        className={`absolute right-0 top-full mt-2 w-64 z-50 font-body origin-top transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] overflow-hidden ${
          open
            ? "max-h-80 opacity-100 pointer-events-auto bg-white border border-ink/15 shadow-[0_4px_20px_rgba(0,0,0,0.08)]"
            : "max-h-0 opacity-0 pointer-events-none border-transparent"
        }`}
      >
        {/* User info */}
        <div
          className={`px-5 py-4 border-b border-ink/10 transition-all duration-300 ${
            open ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2"
          }`}
          style={{ transitionDelay: open ? "60ms" : "0ms" }}
        >
          <div className="flex items-center gap-3">
            {userImage ? (
              <img src={userImage} alt="" className="w-9 h-9 object-cover shrink-0" />
            ) : (
              <div className="w-9 h-9 bg-maroon text-white flex items-center justify-center font-headline font-bold text-[15px] shrink-0">
                {firstInitial}
              </div>
            )}
            <div className="min-w-0">
              <p className="font-headline font-semibold text-[15px] truncate">
                {userName}
              </p>
              <p className="text-[12px] text-caption truncate">{userEmail}</p>
            </div>
          </div>
          <p className="mt-2 text-[11px] tracking-[0.08em] uppercase text-caption font-headline font-semibold">
            {displayRole}
          </p>
        </div>

        {/* Links */}
        <nav className="py-1">
          <DropdownLink href="/account" label="Account Settings" onClick={() => setOpen(false)} open={open} delay={120} />
          {isDashboardRole(userRole) && (
            <DropdownLink href="/dashboard" label="Dashboard" onClick={() => setOpen(false)} open={open} delay={170} />
          )}
          {isAdminRole(userRole) && (
            <DropdownLink href="/admin" label="Admin Panel" onClick={() => setOpen(false)} open={open} delay={220} />
          )}
        </nav>

        {/* Sign out */}
        <div
          className={`border-t border-ink/10 py-1 transition-all duration-300 ${
            open ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2"
          }`}
          style={{ transitionDelay: open ? "250ms" : "0ms" }}
        >
          <form action={signOutAction}>
            <button
              type="submit"
              className="cursor-pointer w-full text-left px-5 py-2.5 text-[14px] font-headline tracking-wide text-caption hover:bg-neutral-50 hover:text-maroon transition-colors"
            >
              Sign Out
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function DropdownLink({
  href,
  label,
  onClick,
  open,
  delay,
}: {
  href: string;
  label: string;
  onClick: () => void;
  open: boolean;
  delay: number;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`block px-5 py-2.5 text-[14px] font-headline tracking-wide hover:bg-neutral-50 hover:text-maroon transition-all duration-300 ${
        open ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2"
      }`}
      style={{ transitionDelay: open ? `${delay}ms` : "0ms" }}
    >
      {label}
    </Link>
  );
}
