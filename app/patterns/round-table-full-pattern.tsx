import Link from "next/link";
import { RoundTableSummary } from "@/app/patterns/types";

function sideName(label: string, idx: number): string {
  return label?.trim() || `Side ${idx + 1}`;
}

const SIDE_THEMES = [
  { text: "#8B1A1A", soft: "rgba(139, 26, 26, 0.08)" },
  { text: "#555555", soft: "rgba(85, 85, 85, 0.12)" },
];

export function RoundTableFullPattern({
  roundTable,
  editMode = false,
}: {
  roundTable?: RoundTableSummary | null;
  editMode?: boolean;
}) {
  if (!roundTable) {
    if (!editMode) return null;
    return (
      <div className="rounded-sm border border-dashed border-maroon/40 bg-maroon/5 px-8 py-12 text-center">
        <p className="font-headline text-[11px] font-bold tracking-[0.2em] uppercase text-maroon">
          The Round Table
        </p>
        <p className="mt-3 font-headline text-[15px] text-caption italic">
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
      className="group block rounded-sm border border-maroon/30 bg-gradient-to-br from-[rgba(139,26,26,0.06)] via-white to-[rgba(26,26,26,0.05)] px-6 py-8 sm:px-12 sm:py-12 hover:border-maroon transition-colors"
    >
      <div className="text-center">
        <p className="font-headline text-[11px] sm:text-[12px] font-bold tracking-[0.22em] uppercase text-maroon">
          The Round Table
        </p>
        <h2 className="mt-3 font-headline text-[28px] sm:text-[40px] lg:text-[48px] font-bold leading-[1.1] max-w-[900px] mx-auto">
          {roundTable.prompt || "This week’s discussion"}
        </h2>
        <div className="mt-5 mx-auto flex items-center justify-center gap-3">
          <span className="h-[3px] w-12 rounded" style={{ backgroundColor: SIDE_THEMES[0].text }} />
          <span className="font-headline text-[10px] font-semibold tracking-[0.22em] uppercase text-caption">
            vs
          </span>
          <span className="h-[3px] w-12 rounded" style={{ backgroundColor: SIDE_THEMES[1].text }} />
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-[860px] mx-auto">
        {roundTable.sides.map((side, i) => {
          const theme = SIDE_THEMES[i] ?? SIDE_THEMES[0];
          return (
            <div
              key={side.order}
              className="rounded-sm px-5 py-4"
              style={{ backgroundColor: theme.soft, boxShadow: `inset 0 0 0 1px ${theme.text}25` }}
            >
              <p
                className="font-headline text-[11px] font-bold tracking-[0.18em] uppercase"
                style={{ color: theme.text }}
              >
                {sideName(side.label, i)}
              </p>
              <p className="mt-1 font-headline text-[15px]">
                {side.authors.length === 0 ? (
                  <span className="italic text-caption">No authors</span>
                ) : (
                  side.authors.map((a) => a.user.name).join(", ")
                )}
              </p>
            </div>
          );
        })}
      </div>

      <div className="mt-8 text-center">
        <span className="inline-flex items-center gap-2 font-headline text-[14px] font-bold tracking-[0.06em] uppercase text-maroon group-hover:underline">
          Read the discussion
          <span className="transition-transform group-hover:translate-x-0.5">&rarr;</span>
        </span>
      </div>
    </Link>
  );
}
