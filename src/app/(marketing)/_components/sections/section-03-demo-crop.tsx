"use client";

import { useEffect, useRef, useState } from "react";
import { DEMO_GRID_SLOTS } from "@/lib/landing";

const CLAMP_PCT = 15;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

// Scoped to drag-to-reposition rather than a full crop tool -- fabric.js
// isn't a portable dependency to pull in for one gesture, and the real
// annotation editor is built for markup/comments, not a clonable crop
// widget. Pointer-drag translates object-position within clamped bounds.
export function DemoCropReposition() {
  const media = DEMO_GRID_SLOTS[1].image;
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [failed, setFailed] = useState(false);
  const draggingRef = useRef(false);
  const lastPointRef = useRef({ x: 0, y: 0 });
  const imgRef = useRef<HTMLImageElement>(null);

  // Same hydration-race fallback as LandingMedia -- a guaranteed-404 image's
  // native error event can fire before React finishes hydrating and attaches
  // onError, so this checks the already-settled state once on mount too.
  useEffect(() => {
    if (imgRef.current?.complete && imgRef.current.naturalWidth === 0) setFailed(true);
  }, []);

  function handlePointerDown(e: React.PointerEvent) {
    draggingRef.current = true;
    lastPointRef.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!draggingRef.current) return;
    const dx = e.clientX - lastPointRef.current.x;
    const dy = e.clientY - lastPointRef.current.y;
    lastPointRef.current = { x: e.clientX, y: e.clientY };
    setOffset((prev) => ({
      x: clamp(prev.x + dx / 3, -CLAMP_PCT, CLAMP_PCT),
      y: clamp(prev.y + dy / 3, -CLAMP_PCT, CLAMP_PCT),
    }));
  }

  function handlePointerUp() {
    draggingRef.current = false;
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <p className="text-xs tracking-wide text-muted uppercase">Drag inside the frame to reposition</p>
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        className="relative aspect-[4/5] w-full max-w-xs cursor-grab touch-none overflow-hidden rounded-md border border-border active:cursor-grabbing"
      >
        {failed && (
          <div className="absolute inset-0 flex items-center justify-center border border-dashed border-border bg-black/[.02] text-center text-[10px] tracking-wide text-muted uppercase">
            {media.alt}
          </div>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={`/landing/${media.src}`}
          alt={media.alt}
          draggable={false}
          style={{ objectPosition: `${50 + offset.x}% ${50 + offset.y}%`, opacity: failed ? 0 : 1 }}
          className="h-full w-full select-none object-cover"
          onError={() => setFailed(true)}
        />
      </div>
    </div>
  );
}
