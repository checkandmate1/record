import Link from "next/link";
import { PopulatedSlot } from "@/app/patterns/types";
import { scalePx } from "@/lib/scale";
import { getBylineAuthors } from "@/lib/article-helpers";
import { BylineAuthors } from "@/app/patterns/byline-authors";
import {
  EditableSlot,
  EditableImage,
  EditableImagePlaceholder,
} from "@/app/patterns/editable";
import { cropRatioClass } from "@/app/patterns/crop";
import { getPlaceholderArticle } from "@/app/patterns/placeholder";

export function SbTwoSmallPattern({
  slots,
  editMode = false,
}: {
  slots: PopulatedSlot[];
  editMode?: boolean;
}) {
  const displaySlots = slots.slice(0, 2);
  if (!editMode && displaySlots.every((s) => !s?.article)) return null;

  return (
    <div className="flex gap-4">
      {displaySlots.map((slot, idx) => {
        const article = slot?.article ?? getPlaceholderArticle();
        const { authors, primaryRole } = getBylineAuthors(article);
        const imgSrc = slot?.mediaUrl ?? null;
        const cropRatio = cropRatioClass(slot?.imageCrop, slot?.imageCropCustom);
        return (
          <div key={slot?.id ?? idx} className="flex-1">
            {imgSrc ? (
              <EditableImage
                slot={slot!}
                href={`/article/${article.slug}`}
                src={imgSrc}
                alt={slot?.mediaAlt ?? article.title}
                imgClassName="w-full object-cover"
                imgStyle={
                  cropRatio
                    ? { aspectRatio: cropRatio }
                    : { height: scalePx(80, slot?.imageScale) }
                }
              />
            ) : editMode && slot ? (
              <EditableImagePlaceholder
                slot={slot}
                className="w-full"
                style={{ height: scalePx(80, slot.imageScale) }}
                label="+ img"
              />
            ) : null}
            <EditableSlot slot={slot}>
              <>
                <h4
                  className="font-headline font-bold leading-snug mt-1.5"
                  style={{ fontSize: scalePx(16, slot?.scale) }}
                >
                  <Link
                    href={`/article/${article.slug}`}
                    className="hover:text-maroon transition-colors"
                  >
                    {article.title}
                  </Link>
                </h4>
                <p
                  className="font-headline mt-1"
                  style={{ fontSize: scalePx(12, slot?.scale) }}
                >
                  <BylineAuthors
                    authors={authors}
                    linkClassName="text-maroon font-semibold hover:underline"
                  />
                  {primaryRole && authors.length === 1 && (
                    <>
                      {" "}
                      <span className="italic">{primaryRole}</span>
                    </>
                  )}
                </p>
              </>
            </EditableSlot>
          </div>
        );
      })}
    </div>
  );
}
