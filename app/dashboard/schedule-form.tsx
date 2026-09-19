"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { isoToLocalInput, localInputToIso } from "@/lib/datetime-local";

/**
 * The schedule control on the issue editor.
 *
 * `scheduleGroup` requires an ISO 8601 instant with an explicit UTC offset: a bare
 * `<input type="datetime-local">` value has no zone, so the server would read the editor's
 * 6 PM as 6 PM UTC. This component converts the value in the BROWSER — where "local" is the
 * editor's zone — before calling the action, shows the action's error inline instead of
 * throwing into the route error boundary (same shape as `layout-builder.tsx`), and disables
 * the button while the request is in flight.
 */
export function ScheduleForm({
  scheduledAtIso,
  action,
}: {
  /** The issue's current `scheduledAt`, as an ISO string (null when unscheduled). */
  scheduledAtIso: string | null;
  /** `scheduleGroup` already bound to the group id. */
  action: (formData: FormData) => Promise<void>;
}) {
  // Rendered from the ISO instant on the client so the input shows the editor's local time,
  // not UTC. It starts empty on the server pass and fills in on hydration.
  const [value, setValue] = useState(() => isoToLocalInput(scheduledAtIso));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setError(null);

    const iso = localInputToIso(value);
    if (!iso) {
      setError("Pick a date and time to schedule this issue.");
      return;
    }

    const formData = new FormData();
    formData.set("scheduledAt", iso);

    startTransition(async () => {
      try {
        await action(formData);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "That schedule could not be saved.");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-1">
      <div className="flex gap-2 items-center">
        {/* A real <label> rather than aria-label (see #56): it is announced the same way but is
            also a click target, and survives translation tooling. */}
        <label htmlFor="group-scheduled-at" className="sr-only">
          Schedule publication
        </label>
        <input
          id="group-scheduled-at"
          type="datetime-local"
          name="scheduledAt"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="border border-ink/20 px-3 py-2 font-headline text-[13px] outline-none focus:border-ink transition-colors"
        />
        <button
          type="submit"
          disabled={pending}
          className="cursor-pointer font-headline font-bold text-[13px] tracking-wide border border-ink/20 px-4 py-2 hover:border-maroon hover:text-maroon transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Scheduling…" : "Schedule"}
        </button>
      </div>
      {error && (
        <p role="alert" className="font-headline text-[12px] tracking-wide text-maroon">
          {error}
        </p>
      )}
    </form>
  );
}
