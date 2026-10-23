"use client";

import { useEffect, useRef, useState } from "react";
import { CroppedCoverImage } from "@/app/projects/[projectId]/grid/grid-crop-overlay";
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
  mediaType: "image" | "video" | "pdf";
};

export type FlatMedia = {
  key: string;
  url: string;
  mediaType: "image" | "video" | "pdf";
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
      <div className={className}>
        <VideoCoverPlayer url={media.url} posterUrl={media.posterUrl} coverTransform={coverTransform} />
      </div>
    );
  }
  // PDF has no equivalent to video's native poster attribute -- a plain
  // <img> can't decode the raw PDF file at all, so this tile always shows
  // its generated page-1 cover instead (posterUrl), same source Story
  // cards use for their own cover. Falls back to the raw url only for an
  // asset uploaded before cover generation existed.
  const imageSrc = media.mediaType === "pdf" ? (media.posterUrl ?? media.url) : media.url;
  return (
    <button
      type="button"
      onClick={onOpen}
      title="View larger"
      className={`${className} cursor-zoom-in transition-opacity duration-150 hover:opacity-90`}
    >
      <CroppedCoverImage src={imageSrc} transform={coverTransform} className="h-full w-full select-none" />
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
            <VideoCoverPlayer url={current.url} posterUrl={current.posterUrl} coverTransform={current.coverTransform} />
          ) : (
            // A PDF here shows its generated page-1 cover, not a live
            // embedded viewer -- this lightbox's box is a fixed, cropped
            // post/story aspect ratio (object-cover), which isn't a
            // sensible frame for an interactive document anyway; the
            // original PDF stays the real source of truth for anyone who
            // needs to actually read it.
            <CroppedCoverImage
              src={current.mediaType === "pdf" ? (current.posterUrl ?? current.url) : current.url}
              transform={current.coverTransform}
              className="h-full w-full"
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

// A video, cover first: the cover the app shows for it -- the saved Edit
// Cover result (or automatic poster) with the post's saved Grid framing when
// it's the cover item -- with a Play control. Play plays the ORIGINAL video,
// whole (object-contain on black: a landscape or 9:16 video is letter/
// pillar-boxed in this fixed box, never cropped), with normal controls.
// "Show cover" (or the video ending) returns to the cover. Nothing autoplays.
//
// This replaced a raw <video object-cover autoPlay>, which never showed the
// edited cover (the poster attribute vanishes the moment autoplay starts),
// ignored the Grid framing, and cropped every video to the box.
//
// One <video> is always mounted underneath (preload="metadata", so a cover
// that's showing costs no video download) and Play calls play() directly in
// the tap handler -- iOS only allows sound playback started inside the
// user's gesture, which a freshly-mounted autoPlay element isn't. With no
// cover image at all, that paused video (its first frame) is the cover.
// Fills its parent box; never changes size, so nothing jumps.
export function VideoCoverPlayer({
  url,
  posterUrl,
  coverTransform,
}: {
  url: string;
  posterUrl: string | null;
  coverTransform: GridCoverTransform | null;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);

  function play() {
    // A load failure usually surfaces early (preload="metadata"), before
    // Play. Retry once from scratch: the error event fires again if it's
    // still broken, which shows the message while "playing".
    if (failed) {
      setFailed(false);
      videoRef.current?.load();
    }
    setPlaying(true);
    const video = videoRef.current;
    video?.play().catch((error: unknown) => {
      // NotSupportedError = no playable source (missing file, unsupported
      // format): say so. Anything else (e.g. an autoplay policy) leaves the
      // native controls showing, so the user can start it themselves.
      if ((error instanceof DOMException && error.name === "NotSupportedError") || video.error) setFailed(true);
    });
  }
  function showCover() {
    videoRef.current?.pause();
    setPlaying(false);
  }

  return (
    <div className="relative h-full w-full bg-black" data-video-player={playing ? "playing" : "cover"}>
      <video
        ref={videoRef}
        src={url}
        preload="metadata"
        playsInline
        controls={playing}
        onEnded={() => setPlaying(false)}
        onError={() => setFailed(true)}
        className="h-full w-full object-contain"
      />
      {!playing && posterUrl && (
        <CroppedCoverImage src={posterUrl} transform={coverTransform} className="absolute inset-0 h-full w-full select-none" />
      )}
      {!playing && (
        <button
          type="button"
          onClick={play}
          aria-label="Play video"
          className="group absolute inset-0 flex items-center justify-center bg-transparent focus-visible:outline-none"
        >
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-black/55 text-white shadow-[0_2px_10px_rgba(0,0,0,0.35)] transition-transform duration-150 group-hover:scale-105 group-focus-visible:ring-2 group-focus-visible:ring-white">
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="ml-0.5 h-6 w-6">
              <path d="M8 5.5v13l11-6.5z" />
            </svg>
          </span>
        </button>
      )}
      {playing && (
        <button
          type="button"
          onClick={showCover}
          className="absolute left-2 top-2 rounded-full bg-black/55 px-3 py-1 text-xs tracking-wide text-white uppercase transition-colors duration-150 hover:bg-black/70"
        >
          Show cover
        </button>
      )}
      {playing && failed && (
        <p role="alert" className="absolute inset-x-3 top-1/2 -translate-y-1/2 text-center text-sm text-white">
          This video can&apos;t be played here.
        </p>
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
