"use client";

import { useMemo, useState } from "react";
import type { SharedGalleryItem } from "@/lib/data/share-preview";
import { Lightbox, MediaFrame, type FlatMedia } from "@/components/media-gallery";

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
