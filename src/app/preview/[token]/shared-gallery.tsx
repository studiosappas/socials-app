"use client";

import { useEffect, useMemo, useState } from "react";
import type { SharedGalleryItem } from "@/lib/data/share-preview";

type FlatMedia = {
  key: string;
  url: string;
  mediaType: "image" | "video";
  posterUrl: string | null;
  contentType: SharedGalleryItem["type"];
};

// Every selected post/story renders together in one continuous scroll, and
// within a single post/story every image or video renders together too --
// no slide-at-a-time paging in the default view, no swipe/dots. Every frame
// is forced into its content type's standard aspect ratio (post 1080x1440
// = 3:4, story 1080x1920 = 9:16) rather than each source image's own
// dimensions, so a set of mixed-aspect uploads still reads as one
// consistent grid. Clicking any image opens it full-size in a lightbox that
// can slide through every image/video on the page (in the order they
// appear), for a closer look without leaving the page.
export function SharedGallery({
  title,
  projectName,
  items,
}: {
  title: string;
  projectName: string;
  items: SharedGalleryItem[];
}) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const flatMedia = useMemo<FlatMedia[]>(() => {
    const list: FlatMedia[] = [];
    for (const item of items) {
      for (const m of item.media) {
        if (!m.url) continue;
        list.push({ key: m.mediaAssetId, url: m.url, mediaType: m.mediaType, posterUrl: m.posterUrl, contentType: item.type });
      }
    }
    return list;
  }, [items]);

  const indexByKey = useMemo(() => {
    const map = new Map<string, number>();
    flatMedia.forEach((m, i) => map.set(m.key, i));
    return map;
  }, [flatMedia]);

  if (items.length === 0) {
    return (
      <div className="flex h-dvh w-full flex-col items-center justify-center gap-2 bg-background px-6 text-center">
        <span className="text-xs tracking-wide text-muted uppercase">Preview Unavailable</span>
        <p className="max-w-xs text-sm text-muted">This link doesn&apos;t have any content to show yet.</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh w-full flex-col items-center gap-14 bg-background px-4 py-12 text-foreground sm:gap-20 sm:px-8 sm:py-16">
      <header className="flex flex-col items-center gap-1 text-center">
        <span className="text-xs tracking-wide text-muted uppercase">{title || `${projectName} — Client Preview`}</span>
      </header>

      {items.map((item) => (
        <section key={item.id} className="animate-settle-in flex w-full flex-col items-center">
          {item.media.length > 1 ? (
            <div className="flex w-full max-w-6xl flex-wrap items-center justify-center gap-3">
              {item.media.map((m) => (
                <MediaFrame
                  key={m.mediaAssetId}
                  media={m}
                  type={item.type}
                  grouped
                  onOpen={() => {
                    const i = indexByKey.get(m.mediaAssetId);
                    if (i !== undefined) setLightboxIndex(i);
                  }}
                />
              ))}
            </div>
          ) : (
            <MediaFrame
              media={item.media[0]}
              type={item.type}
              onOpen={() => {
                const i = indexByKey.get(item.media[0].mediaAssetId);
                if (i !== undefined) setLightboxIndex(i);
              }}
            />
          )}
        </section>
      ))}

      {lightboxIndex !== null && (
        <Lightbox
          media={flatMedia}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onPrev={() => setLightboxIndex((i) => (i === null ? i : (i - 1 + flatMedia.length) % flatMedia.length))}
          onNext={() => setLightboxIndex((i) => (i === null ? i : (i + 1) % flatMedia.length))}
        />
      )}
    </div>
  );
}

const ASPECT_CLASS: Record<SharedGalleryItem["type"], string> = {
  post: "aspect-[3/4]",
  story: "aspect-[9/16]",
};

// Solo (one item in the section) gets a bigger box than grouped (several
// sitting side by side) so the "maximum practical size" reading still holds
// when there's only one thing to show.
const WIDTH_CLASS: Record<SharedGalleryItem["type"], { solo: string; grouped: string }> = {
  post: { solo: "w-full max-w-[430px]", grouped: "w-40 sm:w-56" },
  story: { solo: "w-full max-w-[380px]", grouped: "w-36 sm:w-48" },
};

// Lightbox sizing: maximize within the viewport while staying locked to the
// content type's fixed ratio -- width is capped at whichever is smaller,
// 92% of viewport width or the width that a 86dvh-tall box of this ratio
// would have (86 * 3/4 = 64.5, 86 * 9/16 = 48.375), then aspect-* derives
// the matching height, so it's never taller than 86dvh either.
const LIGHTBOX_BOX_CLASS: Record<SharedGalleryItem["type"], string> = {
  post: "w-[min(92vw,64.5dvh)] aspect-[3/4]",
  story: "w-[min(92vw,48.375dvh)] aspect-[9/16]",
};

function MediaFrame({
  media,
  type,
  grouped = false,
  onOpen,
}: {
  media: SharedGalleryItem["media"][number];
  type: SharedGalleryItem["type"];
  grouped?: boolean;
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
      <img src={media.url} alt="" draggable={false} className="h-full w-full object-cover select-none" />
    </button>
  );
}

function Lightbox({
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
            <img src={current.url} alt="" className="h-full w-full object-cover" />
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
