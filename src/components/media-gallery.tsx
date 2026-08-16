"use client";

import { useEffect } from "react";
import { coverTransformStyle } from "@/app/projects/[projectId]/grid/grid-crop-overlay";
import type { GridCoverTransform } from "@/app/projects/[projectId]/grid/grid-board";

// Shared with the anonymous Shared Client Preview (`/preview/[token]`,
// `shared-gallery.tsx`) and the authenticated Client Review Mode
// (`.../review`, `review-gallery.tsx`) -- this is the one actual gallery/
// lightbox implementation in the app; both callers render the same
// component instead of each having their own copy. Extracted from
// shared-gallery.tsx, which is the original of the two -- its own behavior
// is unchanged by this move.
export type GalleryItemType = "post" | "story";

export type GalleryMedia = {
  mediaAssetId: string;
  url: string | null;
  posterUrl: string | null;
  mediaType: "image" | "video";
};

export type FlatMedia = {
  key: string;
  url: string;
  mediaType: "image" | "video";
  posterUrl: string | null;
  contentType: GalleryItemType;
  // Only ever set for a post's cover (first media item) -- see
  // SharedGalleryItem.coverTransform's own comment.
  coverTransform: GridCoverTransform | null;
};

export const ASPECT_CLASS: Record<GalleryItemType, string> = {
  post: "aspect-[3/4]",
  story: "aspect-[9/16]",
};

// Solo (one item in the section) gets a bigger box than grouped (several
// sitting side by side) so the "maximum practical size" reading still holds
// when there's only one thing to show.
export const WIDTH_CLASS: Record<GalleryItemType, { solo: string; grouped: string }> = {
  post: { solo: "w-full max-w-[430px]", grouped: "w-40 sm:w-56" },
  story: { solo: "w-full max-w-[380px]", grouped: "w-36 sm:w-48" },
};

// Lightbox sizing: maximize within the viewport while staying locked to the
// content type's fixed ratio -- width is capped at whichever is smaller,
// 92% of viewport width or the width that a 86dvh-tall box of this ratio
// would have (86 * 3/4 = 64.5, 86 * 9/16 = 48.375), then aspect-* derives
// the matching height, so it's never taller than 86dvh either.
export const LIGHTBOX_BOX_CLASS: Record<GalleryItemType, string> = {
  post: "w-[min(92vw,64.5dvh)] aspect-[3/4]",
  story: "w-[min(92vw,48.375dvh)] aspect-[9/16]",
};

export function MediaFrame({
  media,
  type,
  grouped = false,
  coverTransform = null,
  onOpen,
}: {
  media: GalleryMedia;
  type: GalleryItemType;
  grouped?: boolean;
  // Only ever passed for a post's cover item -- see FlatMedia's own comment.
  coverTransform?: GridCoverTransform | null;
  onOpen: () => void;
}) {
  if (!media.url) return null;
  const className = `${WIDTH_CLASS[type][grouped ? "grouped" : "solo"]} ${ASPECT_CLASS[type]} shrink-0 overflow-hidden bg-black/[.03]`;
  if (media.mediaType === "video") {
    return (
      <video
        src={media.url}
        poster={media.posterUrl ?? undefined}
        controls
        playsInline
        className={`${className} object-cover`}
      />
    );
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      title="View larger"
      className={`${className} cursor-zoom-in transition-opacity duration-150 hover:opacity-90`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={media.url}
        alt=""
        draggable={false}
        className="h-full w-full object-cover select-none"
        style={coverTransformStyle(coverTransform)}
      />
    </button>
  );
}

export function Lightbox({
  media,
  index,
  onClose,
  onPrev,
  onNext,
}: {
  media: FlatMedia[];
  index: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const current = media[index];

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") onPrev();
      if (e.key === "ArrowRight") onNext();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, onPrev, onNext]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background/98 backdrop-blur-sm">
      <button type="button" aria-label="Close" onClick={onClose} className="fixed inset-0 -z-10 cursor-default" />

      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full text-foreground/60 transition-colors duration-150 hover:text-foreground"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-5 w-5">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 sm:px-16">
        {media.length > 1 && (
          <>
            <LightboxArrow direction="prev" onClick={onPrev} />
            <LightboxArrow direction="next" onClick={onNext} />
          </>
        )}

        <div key={current.key} className={`animate-settle-in shrink-0 overflow-hidden bg-black/[.03] ${LIGHTBOX_BOX_CLASS[current.contentType]}`}>
          {current.mediaType === "video" ? (
            <video
              src={current.url}
              poster={current.posterUrl ?? undefined}
              controls
              playsInline
              autoPlay
              className="h-full w-full object-cover"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={current.url}
              alt=""
              className="h-full w-full object-cover"
              style={coverTransformStyle(current.coverTransform)}
            />
          )}
        </div>
      </div>

      {media.length > 1 && (
        <div className="flex shrink-0 items-center justify-center pb-6">
          <span className="text-xs tracking-wide text-muted uppercase">
            {index + 1} / {media.length}
          </span>
        </div>
      )}
    </div>
  );
}

function LightboxArrow({ direction, onClick }: { direction: "prev" | "next"; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={direction === "prev" ? "Previous" : "Next"}
      className={`absolute top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-foreground/50 transition-colors duration-150 hover:text-foreground ${
        direction === "prev" ? "left-1 sm:left-4" : "right-1 sm:right-4"
      }`}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-5 w-5">
        {direction === "prev" ? <path d="M15 5l-7 7 7 7" /> : <path d="M9 5l7 7-7 7" />}
      </svg>
    </button>
  );
}
