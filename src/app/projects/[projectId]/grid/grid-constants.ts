// TWO deliberately separate canonical ratios -- do not merge these into
// one constant. They describe two different things:
//
// GRID COVER -- the Grid feed tile itself (position 0 of a post, what the
// Grid renders/exports as a tile). 3:4, exported at 1080x1440. This is
// what the Grid's Crop editor targets.
//
// POST BODY -- every carousel slide AFTER the cover, inside Post Editor's
// own carousel/export. 4:5, exported at 1080x1350. A genuinely different
// composition target from the cover, not a duplicate of it.
//
// (An earlier round of this feature had these swapped -- Grid cover at
// 4:5 and carousel body at 3:4 -- based on an incorrect instruction at
// the time; this file was corrected to the ratios above, which are the
// actual product spec.)

export const GRID_COVER_RATIO_W = 3;
export const GRID_COVER_RATIO_H = 4;
// width / height, e.g. 0.75 for 3:4 -- a cover tile is TALLER than it is
// wide.
export const GRID_COVER_ASPECT_RATIO = GRID_COVER_RATIO_W / GRID_COVER_RATIO_H;
// Tailwind arbitrary-value class -- kept as a literal string constant (not
// built from the numbers above at runtime) specifically so Tailwind's
// content scanner, which looks for class-shaped tokens directly in source
// text, still finds it wherever this constant is interpolated into a
// className template.
export const GRID_COVER_ASPECT_CLASS = "aspect-[3/4]";

// Base export width for the Grid cover -- height is always derived from
// this via GRID_COVER_ASPECT_RATIO, never hardcoded separately.
export const GRID_COVER_EXPORT_WIDTH = 1080;
export const GRID_COVER_EXPORT_HEIGHT = Math.round(GRID_COVER_EXPORT_WIDTH / GRID_COVER_ASPECT_RATIO);

export const POST_BODY_RATIO_W = 4;
export const POST_BODY_RATIO_H = 5;
export const POST_BODY_ASPECT_RATIO = POST_BODY_RATIO_W / POST_BODY_RATIO_H;
export const POST_BODY_ASPECT_CLASS = "aspect-[4/5]";
export const POST_BODY_EXPORT_WIDTH = 1080;
export const POST_BODY_EXPORT_HEIGHT = Math.round(POST_BODY_EXPORT_WIDTH / POST_BODY_ASPECT_RATIO);

// Both crop renderers in grid-crop-overlay.tsx (the editor and
// CroppedCoverImage) size their <img> to the source's base-cover box
// (naturalW/H * baseScale), which for any image wider than the frame -- a
// landscape photo in the 3:4 portrait cover -- is WIDER than its
// containing block. Tailwind's preflight (`img { max-width: 100% }`)
// silently clamped that width back to the frame's own width while the
// explicit inline height survived, squashing a landscape image to the
// frame's aspect ratio; the pan bounds (computed from the real imgW) then
// let a drag slide that squashed image off the frame and expose empty
// space -- the "image shrinks when dragged horizontally" bug. Portrait
// sources were never affected: they only ever overflow vertically, and
// preflight sets no max-height. Measured in Chromium: a 16:9 source in a
// 150x200 frame rendered 150x200 (aspect 0.75) before, 355.5x200 (1.778)
// after. A plain object (not React.CSSProperties) so the Node-run browser
// check grid-crop-render.check.mjs can import this exact value.
export const UNCLAMPED_IMG_SIZE = { maxWidth: "none", maxHeight: "none" } as const;
