// Which posts.cover_transform values crop EXPORTS -- pure, so
// cover-framing.test.ts runs under Node.
//
// posts.cover_transform is the post cover's pan/zoom/rotate ({ scale, x, y,
// rotation? }, JSONB -- no schema). A scope marker says what a crop applies
// to:
//
//   unmarked (old):  { scale, x, y, rotation? }
//       the Grid's 3:4 window; crops exports at 3:4 exactly as before
//   grid-preview:    { ..., scope: "grid-preview", scopeVersion: 1 }
//       the Grid's 3:4 window, preview only -- exports ship the media at
//       its own saved framing (image covers, carousel videos)
//   reel-cover:      { ..., scope: "reel-cover", scopeVersion: 1 }
//       a standalone Reel's 9:16 cover framing. Exported cover images use
//       the whole 9:16 frame; every 3:4 preview (Grid, tiles, viewers, PDF,
//       Full Feed PNG) shows its fixed, centred 3:4 band -- one crop, both
//       outcomes, see reelCoverFrame below.
//
// Anything that isn't EXACTLY one of the markers -- missing, another scope
// string, another version, wrong types -- is legacy, so an existing framing
// can never silently stop cropping its export. Nothing rewrites existing
// rows: a marker is only ever written with a new, actually changed crop
// (see markCoverFraming's callers).

export const GRID_PREVIEW_SCOPE = "grid-preview";
export const GRID_PREVIEW_SCOPE_VERSION = 1;
export const REEL_COVER_SCOPE = "reel-cover";
export const REEL_COVER_SCOPE_VERSION = 1;

// The aspect (w/h) a reel-cover framing is edited and exported in, and the
// Grid band shown inside it.
export const REEL_COVER_ASPECT = 9 / 16;
export const GRID_BAND_ASPECT = 3 / 4;

export type FramingScope = { scope?: unknown; scopeVersion?: unknown };

export function isGridPreviewFraming(transform: unknown): boolean {
  if (!transform || typeof transform !== "object") return false;
  const t = transform as FramingScope;
  return t.scope === GRID_PREVIEW_SCOPE && t.scopeVersion === GRID_PREVIEW_SCOPE_VERSION;
}

export function isReelCoverFraming(transform: unknown): boolean {
  if (!transform || typeof transform !== "object") return false;
  const t = transform as FramingScope;
  return t.scope === REEL_COVER_SCOPE && t.scopeVersion === REEL_COVER_SCOPE_VERSION;
}

// Which crop a post's cover gets:
//   "reel"         a standalone Reel (one item, a video) -- 9:16 editor with
//                  the Grid band, reel-cover framing
//   "legacy-reel"  a standalone Reel whose cover IMAGE is an older 3:4 one --
//                  keeps the 3:4 crop and its 3:4 export, unmarked, as before
//   "preview"      everything else (image covers, carousels) -- 3:4,
//                  grid-preview
// coverAspect: the cover image's own width/height, when known.
export type CoverFramingKind = "reel" | "legacy-reel" | "preview";

const LEGACY_REEL_COVER_TOLERANCE = 0.01;

export function coverFramingKind(cover: {
  mediaType: "image" | "video" | null | undefined;
  itemCount: number;
  coverAspect?: number | null;
}): CoverFramingKind {
  if (cover.mediaType !== "video" || cover.itemCount !== 1) return "preview";
  const a = cover.coverAspect;
  if (a && Math.abs(a / GRID_BAND_ASPECT - 1) <= LEGACY_REEL_COVER_TOLERANCE) return "legacy-reel";
  return "reel";
}

// A new crop as written by an explicit Crop / Paste Style save, for a cover
// of the given kind. Any marker the input carried (a pasted crop, say) is
// replaced -- the TARGET's kind decides.
export function markCoverFraming<T extends { scale: number; x: number; y: number; rotation?: number }>(
  transform: T,
  kind: CoverFramingKind,
): { scale: number; x: number; y: number; rotation?: number; scope?: string; scopeVersion?: number } {
  const { scale, x, y, rotation } = transform;
  const base = rotation === undefined ? { scale, x, y } : { scale, x, y, rotation };
  if (kind === "reel") return { ...base, scope: REEL_COVER_SCOPE, scopeVersion: REEL_COVER_SCOPE_VERSION };
  if (kind === "legacy-reel") return base;
  return { ...base, scope: GRID_PREVIEW_SCOPE, scopeVersion: GRID_PREVIEW_SCOPE_VERSION };
}

// Kept for its D2 callers' wording: a crop on a "preview" cover.
export function markGridPreviewFraming<T extends object>(transform: T): T & { scope: string; scopeVersion: number } {
  return { ...transform, scope: GRID_PREVIEW_SCOPE, scopeVersion: GRID_PREVIEW_SCOPE_VERSION };
}

// The framing an EXPORT applies to the cover:
//   legacy (unmarked)  -> applied (3:4), as always
//   grid-preview       -> null (preview only)
//   reel-cover         -> applied (9:16) only while the cover is still a
//                         standalone Reel (coverIsReel); after a reorder or
//                         an added item it's preview only
// Callers that don't pass coverIsReel get the safe default (not a Reel).
export function exportCoverFraming<T>(transform: T | null | undefined, coverIsReel = false): T | null {
  if (!transform) return null;
  if (isGridPreviewFraming(transform)) return null;
  if (isReelCoverFraming(transform)) return coverIsReel ? transform : null;
  return transform;
}

// The frame a framing is laid out in, for a box of the given size: the
// framing's own frame (a Reel's 9:16 cover frame, or a post's export frame
// at its chosen aspect), scaled to the LARGEST size that still covers the
// box, sharing its centre. The box then shows exactly the frame's centred
// window of the box's own shape -- for a 3:4 Grid box: a full-width band of
// a taller frame (9:16), a full-height window of a wider one (4:5, 1:1,
// landscape). A box of the frame's own shape shows all of it. Exact for a
// cover image of any aspect, since the image is fitted into this frame, not
// into the box. `natural` resolves an "original" aspect (the image's own).
// Any other framing is laid out in the box itself.
export function coverLayoutFrame(
  transform: unknown,
  box: { w: number; h: number },
  natural?: { w: number; h: number } | null,
): { w: number; h: number } {
  const aspect = framingAspect(transform, natural);
  if (!aspect) return box;
  return aspect <= box.w / box.h ? { w: box.w, h: box.w / aspect } : { w: box.h * aspect, h: box.h };
}

// --- Export framing (posts.aspect_ratio + post_assets.frame_transform) -----
// Never stored in cover_transform: built in memory from the post's chosen
// aspect and the item's own frame_transform, and handed to the same
// renderers (CroppedCoverImage, applyCoverTransform) as any other framing.

export const EXPORT_FRAME_SCOPE = "export-frame";

export type ExportFraming = {
  scale: number;
  x: number;
  y: number;
  rotation?: number;
  scope: typeof EXPORT_FRAME_SCOPE;
  scopeVersion: 1;
  // w/h, or "original" = the rendered image's own aspect
  aspect: number | "original";
};

export function exportFraming(
  aspect: number | "original",
  frame: { scale: number; x: number; y: number; rotation?: number } | null | undefined,
): ExportFraming {
  const { scale = 1, x = 0, y = 0, rotation = 0 } = frame ?? {};
  return { scale, x, y, rotation, scope: EXPORT_FRAME_SCOPE, scopeVersion: 1, aspect };
}

// A carousel slide's (position > 0) framing at the post's shared ratio, as
// the export applies it: an IMAGE slide of a post with a chosen ratio gets
// its own frame at that ratio -- "original" being the FIRST item's
// displayed ratio (firstAspect), never the slide's own. Legacy posts
// (choice null) and video slides: null, i.e. unframed.
export function slideExportFraming(
  choice: "original" | "1:1" | "4:5" | "5:4" | "16:9" | "9:16" | null,
  mediaType: string,
  frame: { scale: number; x: number; y: number; rotation?: number } | null | undefined,
  firstAspect: number | null,
): ExportFraming | null {
  if (!choice || mediaType !== "image") return null;
  const value = choice === "original" ? (firstAspect && firstAspect > 0 ? firstAspect : null) : SLIDE_RATIOS[choice];
  return value ? exportFraming(value, frame) : null;
}
const SLIDE_RATIOS = { "1:1": 1, "4:5": 4 / 5, "5:4": 5 / 4, "16:9": 16 / 9, "9:16": 9 / 16 } as const;

export function isExportFraming(transform: unknown): transform is ExportFraming {
  if (!transform || typeof transform !== "object") return false;
  const t = transform as { scope?: unknown; scopeVersion?: unknown };
  return t.scope === EXPORT_FRAME_SCOPE && t.scopeVersion === 1;
}

// The frame aspect a framing is laid out in, or null for "lay out in the box".
function framingAspect(transform: unknown, natural?: { w: number; h: number } | null): number | null {
  if (isReelCoverFraming(transform)) return REEL_COVER_ASPECT;
  if (!isExportFraming(transform)) return null;
  if (transform.aspect === "original") return natural && natural.h > 0 ? natural.w / natural.h : null;
  return transform.aspect > 0 ? transform.aspect : null;
}

type Framing = { scale: number; x: number; y: number; rotation?: number };

// Whether a crop editor's result is the framing it started from -- the
// crop overlay "saves" on any outside click, so closing it without touching
// anything must not rewrite (and so newly mark) an existing framing. The
// stored marker is deliberately not compared: an unchanged crop is never
// rewritten, whatever its scope; only a real change writes the cover kind's
// marker (markCoverFraming).
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
