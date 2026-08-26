"use client";

import { useEffect, useRef, useState } from "react";
import type { GridCoverTransform } from "./grid-board";
import { GRID_SLOT_ASPECT_RATIO } from "./grid-constants";

const MAX_ZOOM = 4;

const CORNERS = ["tl", "tr", "bl", "br"] as const;
type Corner = (typeof CORNERS)[number];

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeRotation(rotation: number | undefined): 0 | 90 | 180 | 270 {
  const r = (((rotation ?? 0) % 360) + 360) % 360;
  return r === 90 || r === 180 || r === 270 ? r : 0;
}

// The minimum zoom that still guarantees full coverage of the (non-square,
// 4:5) crop viewport, for a given rotation. At 0/180 the image's own
// object-fit:cover sizing already exactly covers the box at zoom=1 (the
// existing, unchanged behavior). At 90/270 the image's effective footprint
// is rotated 90 degrees relative to the box -- a rectangle that exactly
// covers a W x H box at zoom 1 does NOT cover that same box once rotated
// 90 degrees around its own center (its short side is now aligned with the
// box's long side); the exact scale-up needed to close that gap is the
// box's own aspect ratio inverted. Derived, not approximated: for a 4:5 box
// this is exactly 1.25.
function minZoomForRotation(rotation: number): number {
  const r = normalizeRotation(rotation);
  return r === 90 || r === 270 ? 1 / GRID_SLOT_ASPECT_RATIO : 1;
}

// Converts a raw screen-space pan delta (as a fraction of the container)
// into the delta to apply to the image's OWN local (pre-rotation) offset.
// The CSS transform applies scale+translate in the image's local space
// FIRST, then rotate around the box center LAST (see imageStyle below) --
// so at 90/270, a local-space translate ends up pointing sideways on
// screen unless it's first rotated by the inverse of the current rotation.
// Only ever called with rotation in {0,90,180,270}, so this is an exact
// lookup, not trig with floating-point error.
function rotateScreenDeltaToLocal(dxFrac: number, dyFrac: number, rotation: number) {
  switch (normalizeRotation(rotation)) {
    case 90:
      return { dx: dyFrac, dy: -dxFrac };
    case 180:
      return { dx: -dxFrac, dy: -dyFrac };
    case 270:
      return { dx: -dyFrac, dy: dxFrac };
    default:
      return { dx: dxFrac, dy: dyFrac };
  }
}

// Offsets are stored as fractions of the tile's own width/height (not raw
// pixels), so a saved crop renders identically regardless of the tile's
// actual on-screen size (responsive grid columns, export compositing, etc).
export function GridCropOverlay({
  imageUrl,
  initialTransform,
  onSave,
  onCancel,
}: {
  imageUrl: string;
  initialTransform: GridCoverTransform | null;
  onSave: (transform: GridCoverTransform) => void;
  onCancel: () => void;
}) {
  const [rotation, setRotation] = useState<number>(normalizeRotation(initialTransform?.rotation));
  const [zoom, setZoom] = useState(
    Math.max(initialTransform?.scale ?? 1, minZoomForRotation(normalizeRotation(initialTransform?.rotation))),
  );
  const [offset, setOffset] = useState({ x: initialTransform?.x ?? 0, y: initialTransform?.y ?? 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  // containerWidth/Height and cx/cy below are captured once per gesture
  // (at pointerdown) instead of being recomputed from a fresh
  // getBoundingClientRect() on every pointermove -- the tile's on-screen
  // size is fixed for the whole gesture (only the CSS transform inside it
  // changes, which doesn't affect layout), so a fresh read every move was
  // forcing a synchronous layout reflow for no reason, on every single
  // pointer event during the pan/zoom.
  const panRef = useRef<{
    startX: number;
    startY: number;
    startOffset: { x: number; y: number };
    containerWidth: number;
    containerHeight: number;
  } | null>(null);
  const handleDragRef = useRef<{
    startDist: number;
    startZoom: number;
    startOffset: { x: number; y: number };
    cx: number;
    cy: number;
  } | null>(null);

  // Refs mirror the latest committable state and callbacks so the
  // document-level "click outside commits" listener (registered once on
  // mount) always reads current values without needing to re-subscribe on
  // every drag update.
  const latestTransformRef = useRef<GridCoverTransform>({ scale: zoom, x: offset.x, y: offset.y, rotation });
  const onSaveRef = useRef(onSave);
  const onCancelRef = useRef(onCancel);
  useEffect(() => {
    latestTransformRef.current = { scale: zoom, x: offset.x, y: offset.y, rotation };
    onSaveRef.current = onSave;
    onCancelRef.current = onCancel;
  });

  function clampOffset(next: { x: number; y: number }, z: number) {
    const maxOffset = (z - 1) / 2;
    return {
      x: clamp(next.x, -maxOffset, maxOffset),
      y: clamp(next.y, -maxOffset, maxOffset),
    };
  }

  // Crop mode is inline (no popup/backdrop), so "click elsewhere on the
  // page" is what commits it -- tracked via a document listener rather than
  // a backdrop element.
  useEffect(() => {
    function handleDocPointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onSaveRef.current(latestTransformRef.current);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancelRef.current();
    }
    document.addEventListener("pointerdown", handleDocPointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handleDocPointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  function commit() {
    onSave({ scale: zoom, x: offset.x, y: offset.y, rotation });
  }

  // Rotates 90 degrees clockwise, cycling 0->90->180->270->0. Free/
  // arbitrary rotation was deliberately not implemented: it would need the
  // cover-fit scale, the minimum-zoom-to-avoid-corners, AND the pan-bounds
  // clamp to all become real trigonometry, reproduced IDENTICALLY on the
  // server (lib/image-crop.ts, sharp) for exports -- a real correctness
  // risk to get pixel-perfect and bug-free versus a fixed 90-degree step,
  // where sharp's own `.rotate(90|180|270)` is exact and lossless with no
  // interpolation, and the client math is a clean 4-value lookup instead
  // of floating-point sin/cos. A reliable rotation interaction beats a
  // fragile arbitrary-angle one -- see this file's own header comment.
  function handleRotate() {
    const next = normalizeRotation(rotation + 90);
    const nextMinZoom = minZoomForRotation(next);
    const nextZoom = Math.max(zoom, nextMinZoom);
    setRotation(next);
    setZoom(nextZoom);
    setOffset((current) => clampOffset(current, nextZoom));
  }

  function handleImagePointerDown(e: React.PointerEvent<HTMLImageElement>) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = containerRef.current?.getBoundingClientRect();
    panRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startOffset: offset,
      containerWidth: rect?.width ?? 1,
      containerHeight: rect?.height ?? 1,
    };
  }

  function handleImagePointerMove(e: React.PointerEvent<HTMLImageElement>) {
    if (!panRef.current) return;
    const dxFrac = (e.clientX - panRef.current.startX) / panRef.current.containerWidth;
    const dyFrac = (e.clientY - panRef.current.startY) / panRef.current.containerHeight;
    const local = rotateScreenDeltaToLocal(dxFrac, dyFrac, rotation);
    setOffset(
      clampOffset(
        { x: panRef.current.startOffset.x + local.dx, y: panRef.current.startOffset.y + local.dy },
        zoom,
      ),
    );
  }

  function handleImagePointerUp(e: React.PointerEvent<HTMLImageElement>) {
    if (panRef.current) e.currentTarget.releasePointerCapture(e.pointerId);
    panRef.current = null;
  }

  // Corner handles scale the image uniformly around the tile's center --
  // dragging outward enlarges it, dragging inward shrinks it, exactly like
  // Canva's image-crop handles (the frame itself never moves or resizes).
  // Radial distance-from-center is rotation-agnostic, so this needs no
  // rotation-aware adjustment the way panning does.
  function handleCornerPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const startDist = Math.hypot(e.clientX - cx, e.clientY - cy);
    handleDragRef.current = { startDist, startZoom: zoom, startOffset: offset, cx, cy };
  }

  function handleCornerPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!handleDragRef.current) return;
    const { cx, cy } = handleDragRef.current;
    const dist = Math.hypot(e.clientX - cx, e.clientY - cy);
    const ratio = dist / handleDragRef.current.startDist;
    const nextZoom = clamp(handleDragRef.current.startZoom * ratio, minZoomForRotation(rotation), MAX_ZOOM);
    setZoom(nextZoom);
    setOffset(clampOffset(handleDragRef.current.startOffset, nextZoom));
  }

  function handleCornerPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (handleDragRef.current) e.currentTarget.releasePointerCapture(e.pointerId);
    handleDragRef.current = null;
  }

  // rotate() is the OUTERMOST transform (applied last, around the box's own
  // center by default) -- scale+translate happen first, in the image's own
  // local space, exactly matching lib/image-crop.ts's server-side order
  // (rotate the source pixels first, then run the existing crop math
  // against the rotated buffer).
  const imageStyle: React.CSSProperties = {
    transform: `rotate(${rotation}deg) translate(${offset.x * 100}%, ${offset.y * 100}%) scale(${zoom})`,
  };

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 z-20"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => {
        e.stopPropagation();
        commit();
      }}
    >
      {/* Dimmed, unclipped copy shows the full image so the part outside the
          frame stays visible as context, exactly like Canva's crop tool. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageUrl}
        alt=""
        draggable={false}
        onPointerDown={handleImagePointerDown}
        onPointerMove={handleImagePointerMove}
        onPointerUp={handleImagePointerUp}
        className="absolute inset-0 h-full w-full cursor-move touch-none object-cover opacity-40"
        style={imageStyle}
      />
      {/* Full-opacity copy, clipped to the frame -- this is the actual crop. */}
      <div className="absolute inset-0 overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt=""
          draggable={false}
          onPointerDown={handleImagePointerDown}
          onPointerMove={handleImagePointerMove}
          onPointerUp={handleImagePointerUp}
          className="absolute inset-0 h-full w-full cursor-move touch-none object-cover"
          style={imageStyle}
        />
      </div>
      <div className="pointer-events-none absolute inset-0 border-2 border-foreground" />
      {CORNERS.map((corner) => (
        <CornerHandle
          key={corner}
          corner={corner}
          onPointerDown={handleCornerPointerDown}
          onPointerMove={handleCornerPointerMove}
          onPointerUp={handleCornerPointerUp}
        />
      ))}
      {/* Explicit, visible Confirm/Cancel/Rotate -- double-click-to-save and
          click-outside-to-save/Escape-to-cancel all still work (kept for
          anyone used to that gesture), but neither was ever a DISCOVERABLE
          way to exit this editor, and this tile's own kebab menu -- the one
          other control someone might reach for -- sits directly underneath
          this overlay's z-20 (confirmed live: elementFromPoint at the
          kebab's own coordinates returns this overlay's pan image while
          cropping, not the button). A real user with no visible way out
          reads as "stuck" regardless of what the invisible gestures
          technically do. stopPropagation on pointerdown here isn't
          strictly needed (dnd-kit's listeners are already withheld from the
          tile for the whole time this overlay is mounted -- see GridSlot's
          own {...attributes,...listeners} gate), but costs nothing and
          keeps this component correct even if used somewhere without that
          guarantee. */}
      <div
        className="absolute inset-x-0 bottom-2 z-10 flex items-center justify-center gap-2"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onCancel();
          }}
          className="rounded-none border border-background/40 bg-background/90 px-3 py-1.5 text-xs tracking-wide text-foreground uppercase shadow-[0_1px_5px_rgba(0,0,0,0.35)] transition-colors duration-150 hover:bg-background"
        >
          Cancel
        </button>
        <button
          type="button"
          title="Rotate 90°"
          onClick={(e) => {
            e.stopPropagation();
            handleRotate();
          }}
          className="flex items-center justify-center rounded-none border border-background/40 bg-background/90 p-1.5 text-foreground shadow-[0_1px_5px_rgba(0,0,0,0.35)] transition-colors duration-150 hover:bg-background"
        >
          <RotateIcon className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            commit();
          }}
          className="rounded-none border border-foreground bg-foreground px-3 py-1.5 text-xs tracking-wide text-background uppercase shadow-[0_1px_5px_rgba(0,0,0,0.35)] transition-colors duration-150 hover:opacity-90"
        >
          Save
        </button>
      </div>
    </div>
  );
}

function RotateIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <path d="M3 12a9 9 0 1 1 3 6.7" strokeLinecap="round" />
      <path d="M3 17v-5h5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CornerHandle({
  corner,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  corner: Corner;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void;
}) {
  const isTop = corner.startsWith("t");
  const isLeft = corner.endsWith("l");
  return (
    // The visible dot stays the same small size as before (matches the
    // established Canva-style look); the actual pointer-hit area is a
    // larger invisible box around it, so it's comfortable to grab with a
    // finger without looking bigger on screen.
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className={`absolute z-10 flex h-9 w-9 touch-none items-center justify-center ${
        isTop && isLeft ? "cursor-nwse-resize" : ""
      } ${isTop && !isLeft ? "cursor-nesw-resize" : ""} ${!isTop && isLeft ? "cursor-nesw-resize" : ""} ${
        !isTop && !isLeft ? "cursor-nwse-resize" : ""
      }`}
      style={{
        top: isTop ? -18 : undefined,
        bottom: !isTop ? -18 : undefined,
        left: isLeft ? -18 : undefined,
        right: !isLeft ? -18 : undefined,
      }}
    >
      <div className="h-5 w-5 rounded-full border-2 border-foreground bg-background shadow-[0_1px_5px_rgba(0,0,0,0.35)]" />
    </div>
  );
}

export function coverTransformStyle(transform: GridCoverTransform | null): React.CSSProperties {
  if (!transform) return {};
  const rotation = normalizeRotation(transform.rotation);
  return {
    transform: `rotate(${rotation}deg) translate(${transform.x * 100}%, ${transform.y * 100}%) scale(${transform.scale})`,
  };
}
