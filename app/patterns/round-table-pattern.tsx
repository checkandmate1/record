import Link from "next/link";
import { RoundTableSummary } from "@/app/patterns/types";

function sideName(label: string, idx: number): string {
  return label?.trim() || `Side ${idx + 1}`;
}

export function RoundTablePattern({
  roundTable,
  editMode = false,
}: {
  roundTable?: RoundTableSummary | null;
  editMode?: boolean;
}) {
  if (!roundTable) {
    if (!editMode) return null;
    return (
      <div className="rounded-sm border border-dashed border-maroon/40 bg-maroon/5 px-6 py-7 text-center">
        <p className="font-headline text-[11px] font-bold tracking-[0.2em] uppercase text-maroon">
          The Round Table
        </p>
        <p className="mt-2 font-headline text-[14px] text-caption italic">
          No Round Table for this issue yet — create one from the issue editor.
        </p>
      </div>
    );
  }

  return (
    <Link
      // This issue's debate, not whatever is newest: on /?page=2 a bare
      // "/roundtable" points at the wrong edition.
      href={`/roundtable/${roundTable.slug}`}
      className="group block rounded-sm border border-maroon/30 bg-gradient-to-br from-[rgba(139,26,26,0.07)] via-[rgba(139,26,26,0.03)] to-white px-6 py-7 hover:border-maroon transition-colors"
    >
      <p className="font-headline text-[11px] font-bold tracking-[0.2em] uppercase text-maroon">
        The Round Table
      </p>
      <h2 className="mt-2 font-headline text-[24px] sm:text-[28px] font-bold leading-tight">
        {roundTable.prompt || "This week’s discussion"}
      </h2>
      <div className="mt-4 flex flex-col sm:flex-row sm:items-baseline gap-2 sm:gap-4 font-headline text-[13px]">
        {roundTable.sides.map((side, i) => {
          const names = side.authors.map((a) => a.user.name).join(", ");
          return (
            <div key={side.order} className="flex items-baseline gap-2">
              <span className="font-bold tracking-[0.12em] uppercase text-[11px] text-maroon">
                {sideName(side.label, i)}
              </span>
              <span className="italic text-caption">{names || "(no authors)"}</span>
              {i === 0 && roundTable.sides.length > 1 && (
                <span className="hidden sm:inline font-bold tracking-[0.18em] uppercase text-[10px] text-caption/60 mx-1">
                  vs
                </span>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-4 font-headline text-[13px] font-bold tracking-[0.06em] uppercase text-maroon group-hover:underline">
        Read the discussion <span className="transition-transform group-hover:translate-x-0.5">&rarr;</span>
      </p>
    </Link>
  );
}
