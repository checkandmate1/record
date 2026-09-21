"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { isoToLocalInput, localInputToIso } from "@/lib/datetime-local";

/** Nothing to subscribe to — the value only ever differs between server and client. */
const noopSubscribe = () => () => {};

/**
 * The schedule control on the issue editor.
 *
 * `scheduleGroup` requires an ISO 8601 instant with an explicit UTC offset: a bare
 * `<input type="datetime-local">` value has no zone, so the server would read the editor's
 * 6 PM as 6 PM UTC. This component converts the value in the BROWSER — where "local" is the
 * editor's zone — before calling the action.
 *
 * Errors are RETURNED by the action (`{ ok: false, error }`), not thrown: a production build
 * masks thrown server-action messages as "An error occurred in the Server Components render",
 * so the real reason would never reach the editor. They render inline in the same shape
 * `app/dashboard/layout-builder.tsx` uses, and the button is disabled while pending.
 */
export function ScheduleForm({
  scheduledAtIso,
  action,
}: {
  /** The issue's current `scheduledAt`, as an ISO string (null when unscheduled). */
  scheduledAtIso: string | null;
  /** `scheduleGroup` already bound to the group id. */
  action: (formData: FormData) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  // Empty for the server pass AND for hydration, then the real local time on the client.
  // Formatting `scheduledAtIso` during render would use the SERVER's zone (UTC on the box) and
  // the browser's, producing two different values for the same markup — a hydration mismatch on
  // every already-scheduled draft. `useSyncExternalStore` is React's supported way to render a
  // client-only value; the snapshot is a primitive string, so repeated calls compare equal and
  // it does not loop.
  const localValue = useSyncExternalStore(
    noopSubscribe,
    () => isoToLocalInput(scheduledAtIso),
    () => "",
  );
  // Set once the editor types, so a re-render never clobbers what they are entering.
  const [edited, setEdited] = useState<string | null>(null);
  const value = edited ?? localValue;

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
    // The server checks this too; doing it here saves a round trip and gives the same wording.
    if (new Date(iso).getTime() <= Date.now()) {
      setError("Scheduled time must be in the future");
      return;
    }

    const formData = new FormData();
    formData.set("scheduledAt", iso);

    startTransition(async () => {
      try {
        const result = await action(formData);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        // Drop back to the server's value, which the refresh is about to update.
        setEdited(null);
        router.refresh();
      } catch {
        // Only auth/permission failures throw, and those are masked in production anyway.
        setError("That schedule could not be saved.");
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
          onChange={(e) => setEdited(e.target.value)}
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
