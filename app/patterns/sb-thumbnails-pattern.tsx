import Link from "next/link";
import { PopulatedSlot } from "@/app/patterns/types";
import { scalePx } from "@/lib/scale";
import {
  EditableSlot,
  EditableImage,
  EditableImagePlaceholder,
} from "@/app/patterns/editable";
import { cropRatioClass } from "@/app/patterns/crop";
import { getPlaceholderArticle } from "@/app/patterns/placeholder";

export function SbThumbnailsPattern({
  slots,
  editMode = false,
}: {
  slots: PopulatedSlot[];
  editMode?: boolean;
}) {
  const displaySlots = slots.slice(0, 3);
  if (!editMode && displaySlots.every((s) => !s?.article)) return null;

  return (
    <div>
      {displaySlots.map((slot, idx) => {
        const article = slot?.article ?? getPlaceholderArticle();
        const imgSrc = slot?.mediaUrl ?? null;
        const thumbSize = scalePx(40, slot?.imageScale);
        const cropRatio = cropRatioClass(slot?.imageCrop, slot?.imageCropCustom);
        return (
          <div
            key={slot?.id ?? idx}
            className={`flex items-center gap-3 py-2.5 ${
              idx < displaySlots.length - 1 ? "border-b border-neutral-200" : ""
            }`}
          >
            {imgSrc ? (
              <EditableImage
                slot={slot!}
                href={`/article/${article.slug}`}
                src={imgSrc}
                alt={slot?.mediaAlt ?? article.title}
                imgClassName="object-cover"
                imgStyle={
                  cropRatio
                    ? { width: thumbSize, aspectRatio: cropRatio }
                    : { width: thumbSize, height: thumbSize }
                }
                wrapperClassName="shrink-0"
              />
            ) : editMode && slot ? (
              <EditableImagePlaceholder
                slot={slot}
                style={{ width: thumbSize, height: thumbSize }}
                label="+"
              />
            ) : null}
            <EditableSlot slot={slot}>
              <h4
                className="font-headline font-bold leading-snug"
                style={{ fontSize: scalePx(15, slot?.scale) }}
              >
                <Link
                  href={`/article/${article.slug}`}
                  className="hover:text-maroon transition-colors"
                >
                  {article.title}
                </Link>
              </h4>
            </EditableSlot>
          </div>
        );
      })}
    </div>
  );
}
