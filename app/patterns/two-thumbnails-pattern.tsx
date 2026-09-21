import Link from "next/link";
import { PopulatedSlot } from "@/app/patterns/types";
import { scalePx } from "@/lib/scale";
import {
  getPreviewText,
  getSectionLabel,
  getSectionHref,
  getBylineAuthors,
} from "@/lib/article-helpers";
import { BylineAuthors } from "@/app/patterns/byline-authors";
import {
  EditableSlot,
  EditableImage,
  EditableImagePlaceholder,
} from "@/app/patterns/editable";
import { cropRatioClass } from "@/app/patterns/crop";
import { getPlaceholderArticle } from "@/app/patterns/placeholder";

export function TwoThumbnailsPattern({
  slots,
  editMode = false,
}: {
  slots: PopulatedSlot[];
  editMode?: boolean;
}) {
  const displaySlots = slots.slice(0, 2);
  if (!editMode && displaySlots.every((s) => !s?.article)) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
      {displaySlots.map((slot, idx) => {
        const article = slot?.article ?? getPlaceholderArticle();
        const { authors, primaryRole } = getBylineAuthors(article);
        const imgSrc = slot?.mediaUrl ?? null;
        const cropRatio = cropRatioClass(slot?.imageCrop, slot?.imageCropCustom);
        const iFloat = slot?.imageFloat ?? "full";
        const isFloated = iFloat === "left" || iFloat === "right";

        if (isFloated && imgSrc) {
          return (
            <div key={slot?.id ?? idx} className="overflow-hidden">
              <EditableImage
                slot={slot!}
                href={`/article/${article.slug}`}
                src={imgSrc}
                alt={slot?.mediaAlt ?? article.title}
                imgClassName="w-full h-full object-cover"
                wrapperClassName={
                  iFloat === "left" ? "float-left mr-3 mb-1" : "float-right ml-3 mb-1"
                }
                wrapperStyle={{
                  width: `${slot?.imageWidth ?? 40}%`,
                  ...(cropRatio ? { aspectRatio: cropRatio } : {}),
                }}
              />
              <EditableSlot slot={slot}>
                <>
                  {slot?.featured && (
                    <span className="block font-headline text-[10px] tracking-[0.1em] uppercase text-white font-semibold bg-maroon px-2 py-0.5 w-fit mt-2 mb-1">
                      Featured
                    </span>
                  )}
                  <Link
                    href={getSectionHref(article.section)}
                    className="font-headline text-maroon italic mt-2 inline-block"
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
                    {getPreviewText(article.body, slot?.previewLength ?? 100)}
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
              <div style={{ clear: "both" }} />
            </div>
          );
        }

        return (
          <div key={slot?.id ?? idx}>
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
                    : { height: scalePx(150, slot?.imageScale) }
                }
              />
            ) : editMode && slot ? (
              <EditableImagePlaceholder
                slot={slot}
                className="w-full"
                style={{ height: scalePx(150, slot.imageScale) }}
                label="+ image"
              />
            ) : null}
            <EditableSlot slot={slot}>
              <>
                {slot?.featured && (
                  <span className="block font-headline text-[10px] tracking-[0.1em] uppercase text-white font-semibold bg-maroon px-2 py-0.5 w-fit mt-2 mb-1">
                    Featured
                  </span>
                )}
                <Link
                  href={getSectionHref(article.section)}
                  className="font-headline text-maroon italic mt-2 inline-block"
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
                  {getPreviewText(article.body, slot?.previewLength ?? 100)}
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
    </div>
  );
}
