/**
 * `<input type="datetime-local">` <-> ISO-instant conversion.
 *
 * The input's value ("2026-09-20T18:00") carries no offset. `scheduleGroup` rejects it for
 * exactly that reason: parsed on the server it means 18:00 UTC, so an editor in New York would
 * schedule an issue 4-5 hours early. These helpers run in the BROWSER, where the local zone is
 * the editor's, and hand the server a real instant.
 */

/** Local datetime-local value -> ISO 8601 with an explicit UTC offset, or null if unusable. */
export function localInputToIso(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  // No offset in the string -> ES2015+ parses it as local time. That is the point.
  const date = new Date(trimmed);
  if (isNaN(date.getTime())) return null;
  return date.toISOString();
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** ISO instant -> datetime-local value in the viewer's zone ("" when there is nothing to show). */
export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (isNaN(date.getTime())) return "";
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}
