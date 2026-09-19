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

export function HeroPattern({
  slots,
  editMode = false,
}: {
  slots: PopulatedSlot[];
  editMode?: boolean;
}) {
  const featuredSlot = slots[0];
  const imageSlot = slots[1];
  const headlineSlots = slots.slice(2, 4);

  // Live mode: skip the entire block if the featured article is missing.
  if (!editMode && !featuredSlot?.article) return null;

  const article = featuredSlot?.article ?? getPlaceholderArticle();
  const heroImage = imageSlot?.mediaUrl ?? null;
  const { authors, primaryRole } = getBylineAuthors(article);
  const fs = featuredSlot?.scale;

  const cropRatio = cropRatioClass(imageSlot?.imageCrop, imageSlot?.imageCropCustom);

  // Live mode: an unfilled slot renders nothing (`EditableSlot` returns null), so
  // its row and divider must go with it — otherwise the layout keeps a stray rule
  // across empty space. Edit mode keeps every slot so it stays clickable.
  const visibleHeadlines = editMode
    ? headlineSlots
    : headlineSlots.filter((s) => s?.article);

  return (
    <div>
      <div className="flex flex-col lg:flex-row gap-6">
        {/* Left — featured article */}
        <div className={heroImage || editMode ? "lg:w-[40%]" : "w-full"}>
          <EditableSlot slot={featuredSlot}>
            <>
              {featuredSlot?.featured && (
                <span className="block font-headline text-[10px] tracking-[0.1em] uppercase text-white font-semibold bg-maroon px-2 py-0.5 w-fit mb-1">
                  Featured
                </span>
              )}
              <Link
                href={getSectionHref(article.section)}
                className="font-headline text-maroon italic"
                style={{ fontSize: scalePx(14, fs) }}
              >
                {getSectionLabel(article.section)}
              </Link>
              <h3
                className="font-headline font-bold leading-snug mt-1"
                style={{ fontSize: scalePx(28, fs) }}
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
                style={{ fontSize: scalePx(16, fs) }}
              >
                {getPreviewText(article.body, featuredSlot?.previewLength ?? 200)}
              </p>
              <div className="font-headline mt-3" style={{ fontSize: scalePx(14, fs) }}>
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

        {/* Right — hero image */}
        {heroImage ? (
          <div className="lg:w-[60%] relative">
            <EditableImage
              slot={imageSlot!}
              src={heroImage}
              alt={imageSlot?.mediaAlt ?? ""}
              imgClassName="w-full object-cover"
              imgStyle={cropRatio ? { aspectRatio: cropRatio } : { height: "100%" }}
              credit={imageSlot?.mediaCredit}
            />
          </div>
        ) : editMode ? (
          <div className="lg:w-[60%] relative">
            <EditableImagePlaceholder
              slot={imageSlot}
              className="w-full"
              style={{ aspectRatio: cropRatio ?? "16/9" }}
              label="+ hero image"
            />
          </div>
        ) : null}
      </div>

      {/* Headline-only articles below */}
      {(visibleHeadlines.length > 0 || editMode) && (
        <div className="mt-3 pt-3 border-t border-neutral-200 flex gap-4 -mb-2">
          {visibleHeadlines.map((slot, idx) => {
            const slotArticle = slot?.article ?? getPlaceholderArticle();
            const hlByline = slot?.showByline ? getBylineAuthors(slotArticle) : null;
            return (
              <div
                key={slot?.id ?? idx}
                className={`flex-1 ${
                  idx < visibleHeadlines.length - 1 ? "border-r border-neutral-200 pr-4" : ""
                }`}
              >
                <EditableSlot slot={slot}>
                  <>
                    <h4
                      className="font-headline font-bold leading-snug"
                      style={{ fontSize: scalePx(18, slot?.scale) }}
                    >
                      <Link
                        href={`/article/${slotArticle.slug}`}
                        className="hover:text-maroon transition-colors"
                      >
                        {slotArticle.title}
                      </Link>
                    </h4>
                    {hlByline && (
                      <p
                        className="font-headline mt-1"
                        style={{ fontSize: scalePx(13, slot?.scale) }}
                      >
                        <BylineAuthors
                          authors={hlByline.authors}
                          linkClassName="text-maroon font-semibold hover:underline"
                        />
                        {hlByline.primaryRole && hlByline.authors.length === 1 && (
                          <>
                            {" "}
                            <span className="italic">{hlByline.primaryRole}</span>
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
      )}
    </div>
  );
}
