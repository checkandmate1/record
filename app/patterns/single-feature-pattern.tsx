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

export function SingleFeaturePattern({
  slots,
  editMode = false,
}: {
  slots: PopulatedSlot[];
  editMode?: boolean;
}) {
  const slot = slots[0];
  if (!editMode && !slot?.article) return null;

  const article = slot?.article ?? getPlaceholderArticle();
  const { authors, primaryRole } = getBylineAuthors(article);
  const sc = slot?.scale;

  const imgSrc = slot?.mediaUrl ?? null;
  const iFloat = slot?.imageFloat ?? "full";
  const isFloated = iFloat === "left" || iFloat === "right";
  const cropRatio = cropRatioClass(slot?.imageCrop, slot?.imageCropCustom);

  const articleContent = (
    <>
      {slot?.featured && (
        <span className="block font-headline text-[10px] tracking-[0.1em] uppercase text-white font-semibold bg-maroon px-2 py-0.5 w-fit mb-1">
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
        style={{ fontSize: scalePx(28, sc) }}
      >
        <Link
          href={`/article/${article.slug}`}
          className="hover:text-maroon transition-colors"
        >
          {article.title}
        </Link>
      </h3>
      <p className="mt-2 leading-[1.65] text-caption" style={{ fontSize: scalePx(16, sc) }}>
        {getPreviewText(article.body, slot?.previewLength ?? 220)}
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
  );

  if (isFloated && imgSrc) {
    return (
      <div className="overflow-hidden">
        <EditableImage
          slot={slot!}
          href={`/article/${article.slug}`}
          src={imgSrc}
          alt={slot?.mediaAlt ?? article.title}
          imgClassName="w-full h-full object-cover"
          credit={slot?.mediaCredit}
          wrapperClassName={
            iFloat === "left" ? "float-left mr-4 mb-2" : "float-right ml-4 mb-2"
          }
          wrapperStyle={{
            width: `${slot?.imageWidth ?? 50}%`,
            ...(cropRatio ? { aspectRatio: cropRatio } : {}),
          }}
        />
        <EditableSlot slot={slot}>{articleContent}</EditableSlot>
        <div style={{ clear: "both" }} />
      </div>
    );
  }

  return (
    <div>
      {imgSrc ? (
        <EditableImage
          slot={slot!}
          href={`/article/${article.slug}`}
          src={imgSrc}
          alt={slot?.mediaAlt ?? article.title}
          imgClassName="w-full object-cover"
          imgStyle={cropRatio ? { aspectRatio: cropRatio } : undefined}
          credit={slot?.mediaCredit}
        />
      ) : editMode && slot ? (
        <EditableImagePlaceholder
          slot={slot}
          className="w-full"
          style={{ aspectRatio: cropRatio ?? "16/9" }}
          label="+ feature image"
        />
      ) : null}
      <div className="mt-4">
        <EditableSlot slot={slot}>{articleContent}</EditableSlot>
      </div>
    </div>
  );
}
