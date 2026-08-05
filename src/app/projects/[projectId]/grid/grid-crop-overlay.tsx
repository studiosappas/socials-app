"use client";

import { useEffect, useRef, useState } from "react";
import type { GridCoverTransform } from "./grid-board";

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

const CORNERS = ["tl", "tr", "bl", "br"] as const;
type Corner = (typeof CORNERS)[number];

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
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
  const [zoom, setZoom] = useState(initialTransform?.scale ?? 1);
  const [offset, setOffset] = useState({ x: initialTransform?.x ?? 0, y: initialTransform?.y ?? 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{ startX: number; startY: number; startOffset: { x: number; y: number } } | null>(
    null,
  );
  const handleDragRef = useRef<{
    startDist: number;
    startZoom: number;
    startOffset: { x: number; y: number };
  } | null>(null);

  // Refs mirror the latest committable state and callbacks so the
  // document-level "click outside commits" listener (registered once on
  // mount) always reads current values without needing to re-subscribe on
  // every drag update.
  const latestTransformRef = useRef<GridCoverTransform>({ scale: zoom, x: offset.x, y: offset.y });
  const onSaveRef = useRef(onSave);
  const onCancelRef = useRef(onCancel);
  useEffect(() => {
    latestTransformRef.current = { scale: zoom, x: offset.x, y: offset.y };
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
    onSave({ scale: zoom, x: offset.x, y: offset.y });
  }

  function handleImagePointerDown(e: React.PointerEvent<HTMLImageElement>) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    panRef.current = { startX: e.clientX, startY: e.clientY, startOffset: offset };
  }

  function handleImagePointerMove(e: React.PointerEvent<HTMLImageElement>) {
    if (!panRef.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const dxFrac = (e.clientX - panRef.current.startX) / rect.width;
    const dyFrac = (e.clientY - panRef.current.startY) / rect.height;
    setOffset(
      clampOffset(
        { x: panRef.current.startOffset.x + dxFrac, y: panRef.current.startOffset.y + dyFrac },
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
  function handleCornerPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const startDist = Math.hypot(e.clientX - cx, e.clientY - cy);
    handleDragRef.current = { startDist, startZoom: zoom, startOffset: offset };
  }

  function handleCornerPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!handleDragRef.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dist = Math.hypot(e.clientX - cx, e.clientY - cy);
    const ratio = dist / handleDragRef.current.startDist;
    const nextZoom = clamp(handleDragRef.current.startZoom * ratio, MIN_ZOOM, MAX_ZOOM);
    setZoom(nextZoom);
    setOffset(clampOffset(handleDragRef.current.startOffset, nextZoom));
  }

  function handleCornerPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (handleDragRef.current) e.currentTarget.releasePointerCapture(e.pointerId);
    handleDragRef.current = null;
  }

  const imageStyle: React.CSSProperties = {
    transform: `translate(${offset.x * 100}%, ${offset.y * 100}%) scale(${zoom})`,
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
    </div>
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
  return {
    transform: `translate(${transform.x * 100}%, ${transform.y * 100}%) scale(${transform.scale})`,
  };
}
