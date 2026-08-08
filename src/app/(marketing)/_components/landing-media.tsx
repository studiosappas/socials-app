"use client";

import { useEffect, useRef, useState } from "react";
import type { MediaRef } from "@/lib/landing";

const ASPECT_CLASS: Record<NonNullable<MediaRef["aspect"]>, string> = {
  "4/5": "aspect-[4/5]",
  "3/4": "aspect-[3/4]",
  "9/16": "aspect-[9/16]",
  "1/1": "aspect-square",
};

// Every image on the landing page renders through here rather than a literal
// <img src="/landing/..."> -- centralizes the /landing/ path prefix (the one
// convention that makes "replace media later" a file-drop, not a code
// change) and shows a graceful placeholder (same dashed-border language as
// Grid/Stories' own "Empty" slots) until a real file exists at that path, so
// the page still looks intentional before public/landing/** is filled in.
export function LandingMedia({ media, className = "" }: { media: MediaRef; className?: string }) {
  const [failed, setFailed] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const aspectClass = media.aspect ? ASPECT_CLASS[media.aspect] : "";

  // The server renders a real <img src> immediately, so the browser starts
  // (and, for a guaranteed-404 placeholder path, finishes) the request
  // before React finishes hydrating and attaches the onError listener below
  // -- a native error event that fires that early is simply missed, never
  // replayed, so onError alone never catches it and the placeholder never
  // shows. This checks the already-settled state once on mount as a
  // fallback for exactly that race; onError still covers any failure that
  // happens later (e.g. a file removed after the page was already open).
  useEffect(() => {
    if (imgRef.current?.complete && imgRef.current.naturalWidth === 0) setFailed(true);
  }, []);

  if (failed) {
    return (
      <div
        className={`flex items-center justify-center border border-dashed border-border bg-black/[.02] text-center text-[10px] tracking-wide text-muted uppercase ${aspectClass} ${className}`}
      >
        {media.alt}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={imgRef}
      src={`/landing/${media.src}`}
      alt={media.alt}
      onError={() => setFailed(true)}
      className={`h-full w-full object-cover ${aspectClass} ${className}`}
    />
  );
}
