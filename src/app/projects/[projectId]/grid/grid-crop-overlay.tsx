"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { GridCoverTransform } from "./grid-board";
import { GRID_SLOT_ASPECT_RATIO } from "./grid-constants";
import {
  clampNum,
  clampOffsetPx,
  coverBaseScale,
  coverageSlackPx,
  minZoomForCoverage,
  normalizeRotationDeg,
} from "@/lib/crop-geometry";

const MAX_ZOOM = 4;
// The editing frame is always exactly 4:5 (the Grid's own output ratio --
// see grid-constants.ts) regardless of how the anchor tile that opened it
// is shaped: Post Editor's own asset strip renders every tile (including
// the cover) at 3:4 for a consistent carousel-thumbnail row, but the
// cover's actual OUTPUT is still 4:5, so the crop frame here must be 4:5
// too, not whatever ratio the anchor happens to be.
const MIN_EDIT_WIDTH = 260;
const VIEWPORT_FRACTION = 0.86;
// Clearance kept between the editor and the viewport edge -- the rotate
// handle sits above the frame, the Save/Cancel bar and corner handles sit
// below/around it, all outside the frame's own box.
const TOP_MARGIN = 56;
const BOTTOM_MARGIN = 48;
const SIDE_MARGIN = 24;

const CORNERS = ["tl", "tr", "bl", "br"] as const;
type Corner = (typeof CORNERS)[number];

type FrameGeom = { width: number; height: number; centerX: number; centerY: number };
type NaturalSize = { w: number; h: number };

function pointerAngleDeg(clientX: number, clientY: number, cx: number, cy: number): number {
  return Math.atan2(clientY - cy, clientX - cx) * (180 / Math.PI);
}

// Loads (or reads, if already cached/decoded) an image's true natural
// pixel dimensions -- the crop model needs the REAL source resolution,
// not whatever size it happens to be displayed at, since that's exactly
// what the old object-fit:cover approach got wrong (it only ever knew
// about the display box). A plain `new Image()` here (not a ref off one
// of the rendered <img> elements) sidesteps the "the load event may have
// already fired before a listener could attach" race for an
// already-cached image -- `.complete` is checked immediately as a
// fallback for that same case.
function useNaturalSize(src: string): NaturalSize | null {
  const [size, setSize] = useState<NaturalSize | null>(null);
  useEffect(() => {
    // Resets to "loading" for a NEW src, not a state mutation driven by
    // some other piece of React state -- src itself is the effect's only
    // dependency, so this is synchronizing with an external resource
    // (image decode), not cascading off other component state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSize(null);
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (!cancelled && img.naturalWidth && img.naturalHeight) {
        setSize({ w: img.naturalWidth, h: img.naturalHeight });
      }
    };
    img.src = src;
    if (img.complete && img.naturalWidth && img.naturalHeight) {
      setSize({ w: img.naturalWidth, h: img.naturalHeight });
    }
    return () => {
      cancelled = true;
    };
  }, [src]);
  return size;
}

// Measures the anchor tile's on-screen position (to center the editor
// over it) and derives the editing frame's OWN size from it -- enlarged
// up to a comfortable minimum (Grid tiles and, especially, Post Editor's
// 96px-wide asset strip tiles are both far too small to drag/rotate
// against directly) and capped against the viewport. Re-measured on
// resize (window resize/orientation change) while the editor is open;
// body scroll is locked for the same duration specifically so this
// fixed-position anchor can't silently drift out from under the tile it
// was opened on.
function useEditFrame(anchorRef: React.RefObject<HTMLElement | null>): FrameGeom | null {
  const [frame, setFrame] = useState<FrameGeom | null>(null);
  useLayoutEffect(() => {
    let rafId: number | null = null;
    let cancelled = false;
    let retriesLeft = 10;
    function recompute() {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) {
        // The anchor's own ref callback can momentarily read null the
        // instant Crop opens -- every sibling slot re-renders on the same
        // interaction-mode change that opens this editor (a shared
        // reducer flag each GridSlot reads), and a fresh inline ref
        // callback on each of THEIR re-renders makes React detach-then-
        // reattach every one of those refs within that same commit. This
        // never reflects a real unmount (confirmed live: the same slot's
        // ref is attached again one frame later) -- retrying via
        // requestAnimationFrame rides past that single-frame window
        // instead of the editor silently never opening. Bounded so a
        // genuinely-gone anchor (the slot itself removed mid-gesture)
        // doesn't retry forever.
        if (!cancelled && retriesLeft > 0) {
          retriesLeft -= 1;
          rafId = requestAnimationFrame(recompute);
        }
        return;
      }
      const maxW = Math.min(window.innerWidth * VIEWPORT_FRACTION, window.innerHeight * VIEWPORT_FRACTION * GRID_SLOT_ASPECT_RATIO);
      const width = clampNum(Math.max(rect.width, MIN_EDIT_WIDTH), 160, Math.max(160, maxW));
      const height = width / GRID_SLOT_ASPECT_RATIO;
      // Clamp the center so the editor -- including the rotate handle
      // above the frame and the Save/Cancel bar below it, both outside
      // the frame's own box -- stays fully on screen even when the
      // anchor tile sits right at the viewport's edge (e.g. the top row
      // of the Grid, with little to no space above it).
      const centerX = clampNum(rect.left + rect.width / 2, width / 2 + SIDE_MARGIN, window.innerWidth - width / 2 - SIDE_MARGIN);
      const centerY = clampNum(
        rect.top + rect.height / 2,
        height / 2 + TOP_MARGIN,
        window.innerHeight - height / 2 - BOTTOM_MARGIN,
      );
      setFrame({ width, height, centerX, centerY });
    }
    recompute();
    window.addEventListener("resize", recompute);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      cancelled = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      window.removeEventListener("resize", recompute);
      document.body.style.overflow = prevOverflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return frame;
}

// The 4:5 Grid slot is a FIXED OUTPUT VIEWPORT, not the source image's own
// bounding box -- the source can (and, for anything not already 4:5,
// always does) extend beyond it above/below/left/right. This editor's
// whole structure exists to make that true: the image is rendered at its
// own natural-aspect-ratio "base cover" size (naturalW/H * baseScale,
// computed once real pixel dimensions are known -- see useNaturalSize/
// useEditFrame above), NOT force-fit into a frame-sized box via
// object-fit, so panning/zooming/rotating can reveal or hide any part of
// the actual source pixels instead of manipulating an already-discarded
// crop. Rendered via a portal (not inline in the Grid tile) so the parts
// of the image extending past the frame have room to actually be visible
// on screen instead of being clipped by the tile's own small box or any
// ancestor's overflow -- see the audit notes in this round's report for
// exactly where the old inline approach was silently discarding pixels.
//
// Canonical transform order (must match lib/image-crop.ts's server-side
// pipeline exactly): scale -> rotate around the image's own center ->
// translate in viewport/world pixels. Translate is OUTERMOST specifically
// so a screen-pixel drag always moves the image in the same screen
// direction regardless of the current rotation (no rotation-aware delta
// conversion needed for panning, unlike the previous 90-degree-only
// implementation).
export function GridCropOverlay({
  imageUrl,
  initialTransform,
  onSave,
  onCancel,
  anchorRef,
}: {
  imageUrl: string;
  initialTransform: GridCoverTransform | null;
  onSave: (transform: GridCoverTransform) => void;
  onCancel: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}) {
  const frame = useEditFrame(anchorRef);
  const natural = useNaturalSize(imageUrl);
  const ready = frame !== null && natural !== null;

  const [rotation, setRotation] = useState<number>(normalizeRotationDeg(initialTransform?.rotation));
  const [zoom, setZoom] = useState<number>(initialTransform?.scale ?? 1);
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: initialTransform?.x ?? 0, y: initialTransform?.y ?? 0 });

  const containerRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{ startClientX: number; startClientY: number; startOffsetPx: { x: number; y: number } } | null>(null);
  const cornerRef = useRef<{ startDist: number; startZoom: number; startOffset: { x: number; y: number } } | null>(null);
  const rotateRef = useRef<{ lastAngle: number } | null>(null);

  const baseScale = ready ? coverBaseScale(frame.width, frame.height, natural.w, natural.h) : 1;
  // Storage unit: offset.x/y are fractions of the image's OWN base-cover
  // size (naturalW*baseScale, naturalH*baseScale) -- not of the frame.
  // This is what lets the exact same stored number reproduce identical
  // framing at any frame pixel size (this small editing stage, a Grid
  // thumbnail, a 1080px export): baseScale is recomputed fresh wherever
  // it's rendered, so the normalization cancels out consistently
  // everywhere. See lib/image-crop.ts's matching comment.
  const imgW = ready ? natural.w * baseScale : 0;
  const imgH = ready ? natural.h * baseScale : 0;

  function toPx(stored: { x: number; y: number }) {
    return { x: stored.x * imgW, y: stored.y * imgH };
  }
  function toStored(px: { x: number; y: number }) {
    return { x: imgW === 0 ? 0 : px.x / imgW, y: imgH === 0 ? 0 : px.y / imgH };
  }
  function clampStoredOffset(stored: { x: number; y: number }, rotationDeg: number, zoomVal: number) {
    if (!ready) return stored;
    const w = imgW * zoomVal;
    const h = imgH * zoomVal;
    const { slackX, slackY } = coverageSlackPx(rotationDeg, w / 2, h / 2, frame!.width / 2, frame!.height / 2);
    return toStored(clampOffsetPx(toPx(stored), rotationDeg, slackX, slackY));
  }

  // Whenever the frame's own pixel size changes (mount, or a window
  // resize while the editor happens to stay open), re-derive the
  // rotation-aware coverage floor and re-clamp -- defensive, not a reset:
  // this only ever RAISES zoom if the new geometry demands it and only
  // ever pulls offset back INSIDE newly-valid bounds, never zeroes either.
  useEffect(() => {
    if (!ready) return;
    const minZ = minZoomForCoverage(frame.width, frame.height, natural.w, natural.h, rotation);
    const nextZoom = Math.max(zoom, minZ);
    // Defensive re-clamp against a geometry change (mount, or a window
    // resize while the editor happens to stay open) -- not a response to
    // other React state, so this is the effect's own job, not something
    // to hoist into render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (nextZoom !== zoom) setZoom(nextZoom);
    const clamped = clampStoredOffset(offset, rotation, nextZoom);
    if (clamped.x !== offset.x || clamped.y !== offset.y) setOffset(clamped);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame, natural]);

  const latestTransformRef = useRef<GridCoverTransform>({ scale: zoom, x: offset.x, y: offset.y, rotation });
  const onSaveRef = useRef(onSave);
  const onCancelRef = useRef(onCancel);
  useEffect(() => {
    latestTransformRef.current = { scale: zoom, x: offset.x, y: offset.y, rotation: normalizeRotationDeg(rotation) };
    onSaveRef.current = onSave;
    onCancelRef.current = onCancel;
  });

  // Crop mode is inline (no popup/backdrop click handler needed of its
  // own), so "click elsewhere on the page" -- including the portal's own
  // backdrop, which sits outside containerRef -- is what commits it.
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
    onSave({ scale: zoom, x: offset.x, y: offset.y, rotation: normalizeRotationDeg(rotation) });
  }

  function handleImagePointerDown(e: React.PointerEvent<HTMLImageElement>) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    panRef.current = { startClientX: e.clientX, startClientY: e.clientY, startOffsetPx: toPx(offset) };
  }

  function handleImagePointerMove(e: React.PointerEvent<HTMLImageElement>) {
    if (!panRef.current || !ready) return;
    const dx = e.clientX - panRef.current.startClientX;
    const dy = e.clientY - panRef.current.startClientY;
    const rawPx = { x: panRef.current.startOffsetPx.x + dx, y: panRef.current.startOffsetPx.y + dy };
    setOffset(clampStoredOffset(toStored(rawPx), rotation, zoom));
  }

  function handleImagePointerUp(e: React.PointerEvent<HTMLImageElement>) {
    if (panRef.current) e.currentTarget.releasePointerCapture(e.pointerId);
    panRef.current = null;
  }

  // Corner handles scale the image uniformly around the frame's center --
  // dragging outward enlarges it, dragging inward shrinks it (the frame
  // itself never moves or resizes). Radial distance-from-center is
  // rotation-agnostic, so this needs no rotation-aware adjustment the way
  // panning does.
  function handleCornerPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    if (!frame) return;
    const startDist = Math.hypot(e.clientX - frame.centerX, e.clientY - frame.centerY);
    cornerRef.current = { startDist, startZoom: zoom, startOffset: offset };
  }

  function handleCornerPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!cornerRef.current || !frame || !ready) return;
    const dist = Math.hypot(e.clientX - frame.centerX, e.clientY - frame.centerY);
    const ratio = dist / cornerRef.current.startDist;
    const minZ = minZoomForCoverage(frame.width, frame.height, natural.w, natural.h, rotation);
    const nextZoom = clampNum(cornerRef.current.startZoom * ratio, minZ, MAX_ZOOM);
    setZoom(nextZoom);
    setOffset(clampStoredOffset(cornerRef.current.startOffset, rotation, nextZoom));
  }

  function handleCornerPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (cornerRef.current) e.currentTarget.releasePointerCapture(e.pointerId);
    cornerRef.current = null;
  }

  // Freeform rotation: pointer-down on the handle, then every move
  // computes the pointer's current angle around the frame center and
  // accumulates the INCREMENTAL step onto the running rotation (not the
  // absolute angle from a fixed start) -- atan2 itself wraps at +-180
  // degrees, so diffing against a fixed start angle would produce a
  // visible ~360-degree snap the instant the pointer crosses that
  // boundary mid-drag. Accumulating steps (each individually normalized
  // into (-180,180]) instead lets rotation move continuously through
  // multiple full turns with no discontinuity, and the running value is
  // only normalized for storage/display, not mid-gesture.
  function handleRotateHandlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    if (!frame) return;
    rotateRef.current = { lastAngle: pointerAngleDeg(e.clientX, e.clientY, frame.centerX, frame.centerY) };
  }

  function handleRotateHandlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!rotateRef.current || !frame || !ready) return;
    const angle = pointerAngleDeg(e.clientX, e.clientY, frame.centerX, frame.centerY);
    let step = angle - rotateRef.current.lastAngle;
    if (step > 180) step -= 360;
    if (step <= -180) step += 360;
    rotateRef.current.lastAngle = angle;
    const nextRotation = rotation + step;
    const minZ = minZoomForCoverage(frame.width, frame.height, natural.w, natural.h, nextRotation);
    // Only ever bumped UP to whatever this new angle requires, never
    // ratcheted back down -- a zoom the user chose above the old floor
    // stays exactly as chosen when rotating back toward a less
    // restrictive angle.
    const nextZoom = Math.max(zoom, minZ);
    setRotation(nextRotation);
    setZoom(nextZoom);
    setOffset(clampStoredOffset(offset, nextRotation, nextZoom));
  }

  function handleRotateHandlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (rotateRef.current) e.currentTarget.releasePointerCapture(e.pointerId);
    rotateRef.current = null;
  }

  if (!ready || !frame) return null;

  const imageStyle: React.CSSProperties = {
    position: "absolute",
    top: "50%",
    left: "50%",
    width: imgW,
    height: imgH,
    cursor: "move",
    touchAction: "none",
    transform: `translate(-50%, -50%) translate(${offset.x * imgW}px, ${offset.y * imgH}px) rotate(${rotation}deg) scale(${zoom})`,
  };

  return createPortal(
    <>
      {/* Backdrop -- deliberately outside containerRef, so a click here
          registers as "outside" via the document listener above and
          commits, same as clicking anywhere else off the editor. */}
      <div className="fixed inset-0 z-[100] bg-background/70" />
      <div
        ref={containerRef}
        className="fixed z-[101]"
        style={{ left: frame.centerX, top: frame.centerY }}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => {
          e.stopPropagation();
          commit();
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: frame.width,
            height: frame.height,
            transform: "translate(-50%, -50%)",
          }}
        >
          {/* Dimmed, unclipped copy -- shows the source extending past the
              frame (above/below for portrait, left/right for landscape)
              exactly as it exists, not a pre-clipped remnant of it. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt=""
            draggable={false}
            onPointerDown={handleImagePointerDown}
            onPointerMove={handleImagePointerMove}
            onPointerUp={handleImagePointerUp}
            className="opacity-35"
            style={imageStyle}
          />
          {/* Full-opacity copy, clipped to the frame -- this is the actual
              crop; overflow-hidden lives on this wrapper only. */}
          <div className="absolute inset-0 overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt=""
              draggable={false}
              onPointerDown={handleImagePointerDown}
              onPointerMove={handleImagePointerMove}
              onPointerUp={handleImagePointerUp}
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
          {/* Rotation handle -- grab and drag freely around the frame
              center for continuous 0-360 degree rotation (see the
              handlers above for the angle-accumulation math). Pointer
              Events throughout, so this works with mouse and touch alike. */}
          <div
            className="absolute left-1/2 top-0 z-10 flex -translate-x-1/2 -translate-y-full flex-col items-center"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div
              onPointerDown={handleRotateHandlePointerDown}
              onPointerMove={handleRotateHandlePointerMove}
              onPointerUp={handleRotateHandlePointerUp}
              title="Drag to rotate"
              className="flex h-7 w-7 touch-none cursor-grab items-center justify-center active:cursor-grabbing"
            >
              <RotateHandleIcon className="h-4 w-4 text-foreground" />
              <span className="sr-only">Rotate</span>
            </div>
            <div className="h-4 w-px bg-foreground/30" />
          </div>
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
      </div>
    </>,
    document.body,
  );
}

function RotateHandleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <circle cx="12" cy="12" r="9" strokeOpacity="0.3" />
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
    // The visible dot stays small; the actual pointer-hit area is a
    // larger invisible box around it, comfortable to grab with a finger
    // without looking bigger on screen.
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

// The one shared, non-interactive renderer for a saved crop transform --
// used everywhere a cropped cover needs to display correctly outside the
// editor itself (Grid tiles, the drag overlay preview, Post Editor's
// asset strip, the public preview/review gallery). Reproduces the SAME
// "true source behind a fixed frame" model the editor uses (natural-size
// image, transform: scale -> rotate -> translate, clipped by the
// wrapper), NOT a plain object-fit:cover img -- that was the exact bug
// being fixed: object-cover pre-clips to the wrapper's own box before any
// transform runs, so it can only ever show what a zoom=1/rotation=0 crop
// would have shown, silently ignoring any real pan/rotation/zoom.
//
// Falls back to plain object-cover when there's no saved transform at
// all (never manually cropped) or before natural size has loaded --
// pixel-identical to every caller's previous behavior for that case, and
// a graceful stand-in for the one render before the load-measurement
// effect resolves (typically near-instant, since the same URL is almost
// always already decoded/cached from being visible elsewhere on the same
// page).
export function CroppedCoverImage({
  src,
  transform,
  className,
  imgClassName,
  alt = "",
  loading,
}: {
  src: string;
  transform: GridCoverTransform | null;
  className?: string;
  // Extra classes applied to the actual rendered <img> (both the
  // measured-transform render and the plain-object-cover fallback) --
  // e.g. an entrance animation or `loading="lazy"` callers previously put
  // directly on their own <img>, which this component now owns.
  imgClassName?: string;
  alt?: string;
  loading?: "lazy" | "eager";
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [frameSize, setFrameSize] = useState<{ w: number; h: number } | null>(null);
  const natural = useNaturalSize(transform ? src : "");

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el || !transform) return;
    const measure = () => setFrameSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [transform]);

  const ready = !!transform && !!natural && !!frameSize && frameSize.w > 0 && frameSize.h > 0;
  const rotation = normalizeRotationDeg(transform?.rotation);

  return (
    <div ref={wrapRef} className={`relative overflow-hidden ${className ?? ""}`}>
      {ready ? (
        (() => {
          const baseScale = coverBaseScale(frameSize.w, frameSize.h, natural.w, natural.h);
          const zoom = Math.max(transform!.scale, minZoomForCoverage(frameSize.w, frameSize.h, natural.w, natural.h, rotation));
          const imgW = natural.w * baseScale;
          const imgH = natural.h * baseScale;
          const { slackX, slackY } = coverageSlackPx(rotation, (imgW * zoom) / 2, (imgH * zoom) / 2, frameSize.w / 2, frameSize.h / 2);
          const clamped = clampOffsetPx({ x: transform!.x * imgW, y: transform!.y * imgH }, rotation, slackX, slackY);
          return (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={src}
              alt={alt}
              draggable={false}
              loading={loading}
              className={`pointer-events-none absolute ${imgClassName ?? ""}`}
              style={{
                top: "50%",
                left: "50%",
                width: imgW,
                height: imgH,
                transform: `translate(-50%, -50%) translate(${clamped.x}px, ${clamped.y}px) rotate(${rotation}deg) scale(${zoom})`,
              }}
            />
          );
        })()
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          draggable={false}
          loading={loading}
          className={`pointer-events-none h-full w-full object-cover ${imgClassName ?? ""}`}
        />
      )}
    </div>
  );
}
