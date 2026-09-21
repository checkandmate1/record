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

export function TextImagesPattern({
  slots,
  editMode = false,
}: {
  slots: PopulatedSlot[];
  editMode?: boolean;
}) {
  const articleSlot = slots[0];
  const imageSlots = slots.slice(1, 3);

  if (!editMode && !articleSlot?.article) return null;

  const article = articleSlot?.article ?? getPlaceholderArticle();
  const { authors, primaryRole } = getBylineAuthors(article);
  const sc = articleSlot?.scale;

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      {/* Left — article text */}
      <div className="lg:w-[40%]">
        <EditableSlot slot={articleSlot}>
          <>
            {articleSlot?.featured && (
              <span className="font-headline text-[10px] tracking-[0.1em] uppercase text-maroon font-semibold">
                Featured
              </span>
            )}
            <Link
              href={getSectionHref(article.section)}
              className="font-headline text-maroon italic"
              style={{ fontSize: scalePx(14, sc) }}
            >
              {getSectionLabel(article.section)}
            </Link>
            <h3
              className="font-headline font-bold leading-snug mt-1"
              style={{ fontSize: scalePx(26, sc) }}
            >
              <Link
                href={`/article/${article.slug}`}
                className="hover:text-maroon transition-colors"
              >
                {article.title}
              </Link>
            </h3>
            <p
              className="mt-2 leading-[1.65] text-caption"
              style={{ fontSize: scalePx(16, sc) }}
            >
              {getPreviewText(article.body, articleSlot?.previewLength ?? 200)}
            </p>
            <div className="font-headline mt-3" style={{ fontSize: scalePx(14, sc) }}>
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
            </div>
          </>
        </EditableSlot>
      </div>

      {/* Right — two tall images side by side */}
      <div className="lg:w-[60%] flex gap-3">
        {imageSlots.map((slot) => {
          const cropRatio = cropRatioClass(slot?.imageCrop, slot?.imageCropCustom);
          if (slot?.mediaUrl) {
            return (
              <div key={slot.id} className="flex-1 relative">
                <EditableImage
                  slot={slot}
                  src={slot.mediaUrl}
                  alt={slot.mediaAlt ?? ""}
                  imgClassName="w-full object-cover"
                  imgStyle={cropRatio ? { aspectRatio: cropRatio } : { height: "100%" }}
                  credit={slot.mediaCredit}
                />
              </div>
            );
          }
          if (editMode && slot) {
            return (
              <div key={slot.id} className="flex-1">
                <EditableImagePlaceholder
                  slot={slot}
                  className="w-full"
                  style={{ aspectRatio: cropRatio ?? "3/4" }}
                  label="+ image"
                />
              </div>
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}
