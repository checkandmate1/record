import Link from "next/link";
import { PopulatedSlot } from "@/app/patterns/types";
import { scalePx } from "@/lib/scale";
import { getPreviewText, getBylineAuthors, getSectionLabel, getSectionHref } from "@/lib/article-helpers";
import { BylineAuthors } from "@/app/patterns/byline-authors";
import {
  EditableSlot,
  EditableImage,
  EditableImagePlaceholder,
} from "@/app/patterns/editable";
import { cropRatioClass } from "@/app/patterns/crop";
import { getPlaceholderArticle } from "@/app/patterns/placeholder";

export function FourGridPattern({
  slots,
  editMode = false,
}: {
  slots: PopulatedSlot[];
  editMode?: boolean;
}) {
  const topSlots = slots.slice(0, 2);
  const bottomSlots = slots.slice(2, 4);

  // Live mode: skip the entire block if NO slot has any content.
  if (!editMode && slots.every((s) => !s?.article)) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
      {/* Top row — headline + short excerpt, no image */}
      {topSlots.map((slot, idx) => {
        const article = slot?.article ?? getPlaceholderArticle();
        const { authors, primaryRole } = getBylineAuthors(article);
        return (
          <div key={slot?.id ?? `top-${idx}`}>
            <EditableSlot slot={slot}>
              <>
                {slot?.featured && (
                  <span className="block font-headline text-[10px] tracking-[0.1em] uppercase text-white font-semibold bg-maroon px-2 py-0.5 w-fit mb-1">
                    Featured
                  </span>
                )}
                <Link
                  href={getSectionHref(article.section)}
                  className="font-headline text-maroon italic inline-block"
                  style={{ fontSize: scalePx(13, slot?.scale) }}
                >
                  {getSectionLabel(article.section)}
                </Link>
                <h4
                  className="font-headline font-bold leading-snug mt-1"
                  style={{ fontSize: scalePx(20, slot?.scale) }}
                >
                  <Link
                    href={`/article/${article.slug}`}
                    className="hover:text-maroon transition-colors"
                  >
                    {article.title}
                  </Link>
                </h4>
                <p
                  className="mt-1.5 leading-[1.6] text-caption"
                  style={{ fontSize: scalePx(15, slot?.scale) }}
                >
                  {getPreviewText(article.body, slot?.previewLength ?? 120)}
                </p>
                <p
                  className="font-headline mt-1.5"
                  style={{ fontSize: scalePx(13, slot?.scale) }}
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

      {/* Bottom row — small thumbnail + headline */}
      {bottomSlots.map((slot, idx) => {
        const article = slot?.article ?? getPlaceholderArticle();
        const { authors, primaryRole } = getBylineAuthors(article);
        const imgSrc = slot?.mediaUrl ?? null;
        const imgSize = scalePx(60, slot?.imageScale);
        const cropRatio = cropRatioClass(slot?.imageCrop, slot?.imageCropCustom);
        return (
          <div key={slot?.id ?? `bottom-${idx}`} className="flex items-start gap-3">
            {imgSrc ? (
              <EditableImage
                slot={slot!}
                href={`/article/${article.slug}`}
                src={imgSrc}
                alt={slot?.mediaAlt ?? article.title}
                imgClassName="object-cover"
                imgStyle={
                  cropRatio
                    ? { width: imgSize, aspectRatio: cropRatio }
                    : { width: imgSize, height: imgSize }
                }
                wrapperClassName="shrink-0"
              />
            ) : editMode && slot ? (
              <EditableImagePlaceholder
                slot={slot}
                style={{ width: imgSize, height: imgSize }}
                label="+"
              />
            ) : null}
            <div className="min-w-0">
              <EditableSlot slot={slot}>
                <>
                  <Link
                    href={getSectionHref(article.section)}
                    className="font-headline text-maroon italic inline-block"
                    style={{ fontSize: scalePx(11, slot?.scale) }}
                  >
                    {getSectionLabel(article.section)}
                  </Link>
                  <h4
                    className="font-headline font-bold leading-snug mt-0.5"
                    style={{ fontSize: scalePx(18, slot?.scale) }}
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
          </div>
        );
      })}
    </div>
  );
}
