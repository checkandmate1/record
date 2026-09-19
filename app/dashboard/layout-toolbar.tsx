"use client";

import { useId, useState } from "react";
import Link from "next/link";

interface LayoutToolbarProps {
  groupId: string;
  groupName: string;
  opacity: number;
  onOpacityChange: (v: number) => void;
}

export function LayoutToolbar({ groupId, groupName, opacity, onOpacityChange }: LayoutToolbarProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const opacityId = useId();

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-ink text-white px-4 py-2">
      <div className="max-w-[1200px] mx-auto flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link
            href={`/dashboard/groups/${groupId}`}
            className="font-headline text-[13px] tracking-wide text-white/70 hover:text-white transition-colors"
          >
            &larr; Back to Group
          </Link>
          <span className="font-headline text-[13px] tracking-wide text-white/50">|</span>
          <span className="font-headline text-[14px] font-semibold tracking-wide">
            Editing: {groupName}
          </span>
        </div>
        <div className="flex items-center gap-4">
          {/* Settings cog */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setSettingsOpen(!settingsOpen)}
              className="cursor-pointer text-white/70 hover:text-white transition-colors p-1"
              title="Settings"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>

            {settingsOpen && (
              <div className="absolute right-0 top-full mt-2 bg-white text-ink border border-neutral-200 shadow-[0_4px_16px_rgba(0,0,0,0.12)] p-4 w-[220px] z-50">
                <p className="font-headline text-[12px] font-semibold tracking-[0.06em] uppercase text-caption mb-3">
                  Editor Settings
                </p>
                <div>
                  <label htmlFor={opacityId} className="block font-headline text-[12px] text-caption mb-1.5">
                    Placeholder Opacity: {Math.round(opacity * 100)}%
                  </label>
                  <input
                    id={opacityId}
                    type="range"
                    min="0.1"
                    max="1"
                    step="0.05"
                    value={opacity}
                    onChange={(e) => onOpacityChange(parseFloat(e.target.value))}
                    className="w-full accent-maroon"
                  />
                  <div className="flex justify-between font-headline text-[10px] text-caption/50 mt-0.5">
                    <span>Faint</span>
                    <span>Full</span>
                  </div>
                </div>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
