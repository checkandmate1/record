import Link from "next/link";
import { RoundTableSummary } from "@/app/patterns/types";

function sideName(label: string, idx: number): string {
  return label?.trim() || `Side ${idx + 1}`;
}

export function SbRoundTablePattern({
  roundTable,
  editMode = false,
}: {
  roundTable?: RoundTableSummary | null;
  editMode?: boolean;
}) {
  if (!roundTable) {
    if (!editMode) return null;
    return (
      <div className="rounded-sm border border-dashed border-maroon/40 bg-maroon/5 px-4 py-5">
        <p className="font-headline text-[10px] font-bold tracking-[0.18em] uppercase text-maroon">
          The Round Table
        </p>
        <p className="mt-2 font-headline text-[13px] text-caption italic">
          No Round Table yet.
        </p>
      </div>
    );
  }

  return (
    <Link
      // This issue's debate, not whatever is newest: on /?page=2 a bare
      // "/roundtable" points at the wrong edition.
      href={`/roundtable/${roundTable.slug}`}
      className="group block rounded-sm border border-maroon/30 bg-gradient-to-br from-[rgba(139,26,26,0.07)] via-[rgba(139,26,26,0.03)] to-white px-4 py-5 hover:border-maroon transition-colors"
    >
      <p className="font-headline text-[10px] font-bold tracking-[0.18em] uppercase text-maroon">
        The Round Table
      </p>
      <h3 className="mt-1.5 font-headline text-[18px] font-bold leading-tight">
        {roundTable.prompt || "This week’s discussion"}
      </h3>
      <ul className="mt-3 space-y-1.5 font-headline text-[12px]">
        {roundTable.sides.map((side, i) => {
          const names = side.authors.map((a) => a.user.name).join(", ");
          return (
            <li key={side.order} className="flex items-baseline gap-2">
              <span className="font-bold tracking-[0.1em] uppercase text-[10px] text-maroon shrink-0">
                {sideName(side.label, i)}
              </span>
              <span className="italic text-caption truncate">
                {names || "(no authors)"}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 font-headline text-[11px] font-bold tracking-[0.06em] uppercase text-maroon group-hover:underline">
        Read &rarr;
      </p>
    </Link>
  );
}
