import Link from "next/link";
import { PopulatedSlot } from "@/app/patterns/types";
import { scalePx } from "@/lib/scale";
import { getBylineAuthors } from "@/lib/article-helpers";
import { BylineAuthors } from "@/app/patterns/byline-authors";
import { EditableSlot } from "@/app/patterns/editable";
import { getPlaceholderArticle } from "@/app/patterns/placeholder";

export function HeadlineStackPattern({
  slots,
  editMode = false,
}: {
  slots: PopulatedSlot[];
  editMode?: boolean;
}) {
  const headlineSlots = slots.slice(0, 3);
  if (!editMode && headlineSlots.every((s) => !s?.article)) return null;

  // Live mode: an unfilled slot renders nothing (`EditableSlot` returns null), so
  // its row and divider must go with it — otherwise the layout keeps a stray rule
  // across empty space. Edit mode keeps every slot so it stays clickable.
  const visibleSlots = editMode ? headlineSlots : headlineSlots.filter((s) => s?.article);

  return (
    <div>
      {visibleSlots.map((slot, idx) => {
        const article = slot?.article ?? getPlaceholderArticle();
        const byline = slot?.showByline ? getBylineAuthors(article) : null;
        return (
          <div
            key={slot?.id ?? idx}
            className={`py-3 ${
              idx < visibleSlots.length - 1 ? "border-b-2 border-black" : ""
            }`}
          >
            <EditableSlot slot={slot}>
              <>
                <h3
                  className="font-headline font-bold leading-snug"
                  style={{ fontSize: scalePx(26, slot?.scale) }}
                >
                  <Link
                    href={`/article/${article.slug}`}
                    className="hover:text-maroon transition-colors"
                  >
                    {article.title}
                  </Link>
                </h3>
                {byline && (
                  <p
                    className="font-headline mt-1"
                    style={{ fontSize: scalePx(14, slot?.scale) }}
                  >
                    <BylineAuthors
                      authors={byline.authors}
                      linkClassName="text-maroon font-semibold hover:underline"
                    />
                    {byline.primaryRole && byline.authors.length === 1 && (
                      <>
                        {" "}
                        <span className="italic">{byline.primaryRole}</span>
                      </>
                    )}
                  </p>
                )}
              </>
            </EditableSlot>
          </div>
        );
      })}
    </div>
  );
}
