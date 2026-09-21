"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

interface IntroAuthor {
  id: string;
  name: string;
  image: string | null;
  sideIndex: number;
}

const SIDE_THEMES = [
  { text: "#8B1A1A", soft: "rgba(139, 26, 26, 0.18)" },
  { text: "#5A5A5A", soft: "rgba(90, 90, 90, 0.28)" },
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

const SEEN_PREFIX = "record:rt-seen:";
export const REPLAY_EVENT = "rt-intro-replay";

/**
 * The intro plays at most once per browser session per edition, and never for a
 * reader who has asked for less motion.
 *
 * `sessionStorage`, not `localStorage`: coming back tomorrow should still feel
 * like an event, but the 2.4 s overlay must not block every navigation back to
 * /roundtable within one sitting. Storage can throw (private mode, blocked site
 * data) — treat that as "already seen" so a failure can never wedge the page
 * behind an overlay.
 */
function alreadySeen(slug: string): boolean {
  try {
    return window.sessionStorage.getItem(SEEN_PREFIX + slug) === "1";
  } catch {
    return true;
  }
}

function markSeen(slug: string) {
  try {
    window.sessionStorage.setItem(SEEN_PREFIX + slug, "1");
  } catch {
    /* ignore */
  }
}

/** A 2.4 s spinning overlay is exactly what `prefers-reduced-motion` is about. */
function prefersReducedMotion(): boolean {
  if (typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function RoundTableSpinIntro({
  slug,
  authors,
  prompt,
}: {
  slug: string;
  authors: IntroAuthor[];
  prompt: string;
}) {
  // Three phases:
  //   "checking"  → SSR + first client render, before we know whether it plays
  //   "playing"   → animation visible, content under it should still be hidden by parent
  //   "done"      → animation finished or skipped, parent reveals content
  const [phase, setPhase] = useState<"checking" | "playing" | "done">("checking");
  const [exiting, setExiting] = useState(false);
  const [bgVisible, setBgVisible] = useState(false);
  const [showCta, setShowCta] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    function startPlayback() {
      // Recorded up front, not in `skip()`: a reader who navigates away without
      // dismissing the overlay has still seen it this session.
      markSeen(slug);
      setExiting(false);
      setShowCta(false);
      setPhase("playing");
    }

    function shouldPlay(): boolean {
      if (prefersReducedMotion()) return false;
      return !alreadySeen(slug);
    }

    if (shouldPlay()) {
      startPlayback();
      // Trigger the backdrop fade-in on the next frame so the transition runs
      requestAnimationFrame(() => setBgVisible(true));
    } else {
      setPhase("done");
      window.dispatchEvent(new CustomEvent("rt-intro-finished"));
    }

    // The QA "Replay intro now" button is an explicit request, so it bypasses
    // both the once-per-session flag and the reduced-motion check.
    function onReplay() {
      setBgVisible(false);
      startPlayback();
      requestAnimationFrame(() => setBgVisible(true));
    }
    window.addEventListener(REPLAY_EVENT, onReplay);
    return () => window.removeEventListener(REPLAY_EVENT, onReplay);
  }, [slug]);

  // After the spin animation (2400ms) wraps up, give the reader 1s of quiet
  // before nudging them with a "Click to continue" CTA.
  useEffect(() => {
    if (phase !== "playing") return;
    const id = window.setTimeout(() => setShowCta(true), 3400);
    return () => window.clearTimeout(id);
  }, [phase]);

  // The intro never dismisses on its own — the spin animation finishes and
  // the overlay sits at rest with the prompt readable until the user clicks.
  function skip() {
    if (exiting) return;
    setExiting(true);
    setBgVisible(false);
    if (typeof window === "undefined") {
      setPhase("done");
      return;
    }
    window.setTimeout(() => {
      markSeen(slug);
      window.dispatchEvent(new CustomEvent("rt-intro-finished"));
      setPhase("done");
    }, 500);
  }

  if (phase !== "playing") return null;
  if (typeof document === "undefined") return null;

  // Distribute authors around the rim
  const total = authors.length || 1;
  const overlay = (
    <>
      <style>{`
        @keyframes rt-spin {
          0%   { transform: rotateZ(0deg) scale(0.6); opacity: 0; }
          15%  { transform: rotateZ(45deg) scale(1); opacity: 1; }
          70%  { transform: rotateZ(900deg) scale(1); opacity: 1; }
          100% { transform: rotateZ(1080deg) scale(1.04); opacity: 1; }
        }
        @keyframes rt-counter-spin {
          /* Counter-rotate to keep avatar text upright */
          0%   { transform: rotateZ(0deg); }
          15%  { transform: rotateZ(-45deg); }
          70%  { transform: rotateZ(-900deg); }
          100% { transform: rotateZ(-1080deg); }
        }
        @keyframes rt-wordmark-in-out {
          0%   { opacity: 0; transform: scale(0.7); }
          12%  { opacity: 1; transform: scale(1); }
          50%  { opacity: 1; transform: scale(1); }
          62%  { opacity: 0; transform: scale(0.85); }
          100% { opacity: 0; transform: scale(0.85); }
        }
        @keyframes rt-prompt-pop {
          0%, 55%  { opacity: 0; transform: scale(0.7); }
          72%      { opacity: 1; transform: scale(1.06); }
          82%      { transform: scale(1); }
          100%     { opacity: 1; transform: scale(1); }
        }
        @keyframes rt-cta-in {
          0%   { opacity: 0; transform: translateY(6px); }
          100% { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      <div
        role="button"
        tabIndex={0}
        onClick={skip}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") skip();
        }}
        aria-label="Skip intro"
        className="fixed inset-0 z-[60] flex items-center justify-center overflow-hidden cursor-pointer"
        style={{
          background:
            "radial-gradient(circle at 50% 50%, rgba(80, 80, 80, 0.92) 0%, rgba(38, 38, 38, 0.97) 45%, rgba(0,0,0,1) 100%)",
          opacity: bgVisible && !exiting ? 1 : 0,
          transition: "opacity 500ms ease",
        }}
      >
        <p
          className="absolute top-6 left-1/2 -translate-x-1/2 font-headline text-[11px] sm:text-[12px] font-bold tracking-[0.32em] uppercase text-white/85"
          style={{ textShadow: "0 2px 8px rgba(0,0,0,0.6)" }}
        >
          The Round Table · This Week’s Discussion
        </p>
        <span className="absolute top-6 right-6 font-headline text-[11px] font-semibold tracking-[0.16em] uppercase text-white/55 pointer-events-none">
          Click to continue
        </span>

        <div
          className="relative"
          style={{
            width: "min(82vmin, 720px)",
            height: "min(82vmin, 720px)",
            animation: "rt-spin 2400ms cubic-bezier(0.32, 0, 0.2, 1) both",
            transformStyle: "preserve-3d",
          }}
        >
          {/* The table itself */}
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background:
                "radial-gradient(circle at 30% 25%, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0.04) 35%, transparent 70%), conic-gradient(from 0deg, #8B1A1A 0deg, #707070 180deg, #8B1A1A 360deg)",
              border: "3px solid rgba(255,255,255,0.22)",
              boxShadow:
                "0 30px 80px rgba(0,0,0,0.55), inset 0 0 60px rgba(0,0,0,0.45)",
            }}
          />

          {/* Inner ring / wood-grain effect */}
          <div
            className="absolute rounded-full"
            style={{
              top: "12%",
              left: "12%",
              right: "12%",
              bottom: "12%",
              background:
                "radial-gradient(circle at 50% 50%, rgba(255,255,255,0.05) 0%, transparent 60%)",
              border: "1px dashed rgba(255,255,255,0.15)",
            }}
          />

          {/* Author avatars positioned around the rim — these counter-rotate
              so they stay upright while the table spins. */}
          {authors.map((a, i) => {
            const angleDeg = (360 / total) * i - 90; // start from top, clockwise
            // Place every avatar OUTSIDE the rim, at the same distance, so they
            // sit around the table consistently like seats at a conference.
            const radius = 56; // % from center (rim is at 50%)
            const angleRad = (angleDeg * Math.PI) / 180;
            const x = 50 + radius * Math.cos(angleRad);
            const y = 50 + radius * Math.sin(angleRad);
            const theme = SIDE_THEMES[a.sideIndex] ?? SIDE_THEMES[0];
            return (
              <div
                key={a.id}
                className="absolute"
                style={{
                  left: `${x}%`,
                  top: `${y}%`,
                  transform: "translate(-50%, -50%)",
                  animation:
                    "rt-counter-spin 2400ms cubic-bezier(0.32, 0, 0.2, 1) both",
                }}
              >
                <div
                  className="rounded-full overflow-hidden bg-neutral-100"
                  style={{
                    width: 56,
                    height: 56,
                    boxShadow: `0 0 0 3px ${theme.text}, 0 8px 20px rgba(0,0,0,0.35)`,
                  }}
                >
                  {a.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={a.image}
                      alt={a.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div
                      className="w-full h-full flex items-center justify-center font-headline font-bold text-white text-[18px]"
                      style={{ backgroundColor: theme.text }}
                    >
                      {initials(a.name)}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Center stack — counter-rotates as a unit so text stays upright.
              The wordmark plays first, then fades out as the prompt fades in bigger. */}
          <div
            className="absolute inset-0 flex items-center justify-center px-[12%]"
            style={{
              animation:
                "rt-counter-spin 2400ms cubic-bezier(0.32, 0, 0.2, 1) both",
            }}
          >
            <div className="relative w-full text-center">
              {/* Wordmark — visible early, fades out around halfway */}
              <p
                className="absolute inset-0 flex items-center justify-center font-headline font-bold uppercase tracking-[0.32em] text-white leading-[1.05]"
                style={{
                  fontSize: "clamp(14px, 2.2vmin, 22px)",
                  textShadow: "0 2px 12px rgba(0,0,0,0.6)",
                  animation:
                    "rt-wordmark-in-out 2400ms cubic-bezier(0.32, 0, 0.2, 1) both",
                }}
              >
                The Round Table
              </p>

              {/* Prompt — fades in bigger after the wordmark exits */}
              <p
                className="font-headline text-white font-bold text-center leading-[1.12]"
                style={{
                  fontSize: "clamp(22px, 4.6vmin, 46px)",
                  textShadow: "0 2px 18px rgba(0,0,0,0.7)",
                  animation:
                    "rt-prompt-pop 2400ms cubic-bezier(0.32, 0, 0.2, 1) both",
                }}
              >
                {prompt || "—"}
              </p>

              {/* Discreet CTA right under the prompt — appears 1s after the spin */}
              {showCta && (
                <p
                  className="mt-4 font-headline text-white/65 text-[11px] sm:text-[12px] tracking-[0.18em] uppercase pointer-events-none"
                  style={{
                    animation:
                      "rt-cta-in 500ms cubic-bezier(0.32,0,0.2,1) both",
                  }}
                >
                  Click to continue &rarr;
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );

  return createPortal(overlay, document.body);
}
