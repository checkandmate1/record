"use client";

import { REPLAY_EVENT } from "@/app/roundtable/round-table-spin-intro";

/**
 * QA-only control in the Round Table drawer.
 *
 * **Render this behind a dashboard-role check** — `past-roundtables-panel.tsx`
 * takes `showIntroControls`, and the pages compute it with `isDashboardRole()`.
 * Readers must never see it.
 *
 * There is no "show only once" toggle any more: the intro always plays at most
 * once per browser session per edition, and never under `prefers-reduced-motion`
 * (`round-table-spin-intro.tsx`). This just replays it on demand so the
 * animation can be checked without clearing session storage.
 */
export function IntroControls() {
  function replay() {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent(REPLAY_EVENT));
  }

  return (
    <section className="mt-8">
      <h3 className="font-headline text-[11px] font-bold tracking-[0.18em] uppercase text-caption">
        Intro Animation (staff)
      </h3>
      <div className="mt-3 h-px bg-neutral-200" />

      <p className="mt-3 font-headline text-[11px] text-caption leading-snug">
        The intro plays once per browser session, and is skipped entirely for
        readers who have reduced motion turned on.
      </p>

      <button
        type="button"
        onClick={replay}
        className="mt-3 cursor-pointer w-full font-headline text-[12px] font-bold tracking-[0.06em] uppercase border border-maroon/40 text-maroon px-4 py-2 hover:bg-maroon hover:text-white transition-colors"
      >
        Replay intro now
      </button>
    </section>
  );
}
