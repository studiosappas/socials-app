// Which posts.cover_transform values crop EXPORTS -- pure, so
// cover-framing.test.ts runs under Node.
//
// posts.cover_transform is the post cover's pan/zoom/rotate inside the
// Grid's 3:4 tile ({ scale, x, y, rotation? }, JSONB -- no schema). It used
// to crop the exported cover too. Now a framing saved by an explicit NEW
// Crop carries a scope marker and is a Grid PREVIEW only: Grid tiles and
// viewers still show it, exports ship the media at its own saved framing
// (4:5 feed edit, 9:16 Reel cover, or the original).
//
//   marked (new):    { scale, x, y, rotation, scope: "grid-preview", scopeVersion: 1 }
//   unmarked (old):  { scale, x, y, rotation? }  -- crops exports exactly as before
//
// Anything that isn't EXACTLY the current marker -- missing, another scope
// string, another version, wrong types -- is treated as legacy, so an
// existing framing can never silently stop cropping its export. Nothing
// rewrites existing rows: the marker is only ever written with a new,
// actually changed crop (see markGridPreviewFraming's callers).

export const GRID_PREVIEW_SCOPE = "grid-preview";
export const GRID_PREVIEW_SCOPE_VERSION = 1;

export type FramingScope = { scope?: unknown; scopeVersion?: unknown };

export function isGridPreviewFraming(transform: unknown): boolean {
  if (!transform || typeof transform !== "object") return false;
  const t = transform as FramingScope;
  return t.scope === GRID_PREVIEW_SCOPE && t.scopeVersion === GRID_PREVIEW_SCOPE_VERSION;
}

// The framing an EXPORT applies to the cover: the stored value for a
// legacy (unmarked) framing, null for a Grid-preview-only one.
export function exportCoverFraming<T>(transform: T | null | undefined): T | null {
  if (!transform) return null;
  return isGridPreviewFraming(transform) ? null : transform;
}

// A new crop as written by an explicit Crop / Paste Style save.
export function markGridPreviewFraming<T extends object>(transform: T): T & { scope: string; scopeVersion: number } {
  return { ...transform, scope: GRID_PREVIEW_SCOPE, scopeVersion: GRID_PREVIEW_SCOPE_VERSION };
}

type Framing = { scale: number; x: number; y: number; rotation?: number };

// Whether a crop editor's result is the framing it started from -- the
// crop overlay "saves" on any outside click, so closing it without touching
// anything must not rewrite (and so newly mark) an existing framing.
export function sameFraming(a: Framing | null | undefined, b: Framing | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  const eps = 1e-9;
  const rot = (r: number | undefined) => {
    const m = (((r ?? 0) % 360) + 360) % 360;
    return m > 180 ? m - 360 : m;
  };
  return (
    Math.abs(a.scale - b.scale) < eps &&
    Math.abs(a.x - b.x) < eps &&
    Math.abs(a.y - b.y) < eps &&
    Math.abs(rot(a.rotation) - rot(b.rotation)) < eps
  );
}
