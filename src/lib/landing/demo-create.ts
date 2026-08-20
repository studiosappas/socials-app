// Demo data for Chapter 02 "Create" -- see stage-02-create.tsx. Reuses
// Chapter 01's real DEMO_MEDIA_FOLDERS/DEMO_MEDIA_LIBRARY_ITEMS
// (demo-media-library.ts) for the Grid sidebar, so the same real assets
// carry across chapters instead of a second, disconnected data set.
import { landingMediaUrl } from "@/lib/landing-media-url";
import { layoutToFabricJson, type DesignLayoutElement } from "@/lib/ai/design-layout";
import type { GridBoardRow } from "@/app/projects/[projectId]/grid/grid-board";
import type { MediaRef } from "./types";

// Compressed lead-in: one quick continuous pan across Moodboard/Fonts/
// Logos/References/Product Images (see stage-02-create.tsx's WorkspacePan)
// rather than five separately-choreographed demos.
export type DemoWorkspaceTile = { id: string; label: string; media: MediaRef };
export const DEMO_WORKSPACE_TILES: DemoWorkspaceTile[] = [
  { id: "moodboard", label: "Moodboard", media: { src: "assets/folder-1.jpg", alt: "Brand moodboard", aspect: "1/1" } },
  { id: "fonts", label: "Fonts", media: { src: "assets/folder-3.jpg", alt: "Brand fonts", aspect: "1/1" } },
  { id: "logos", label: "Logos", media: { src: "assets/folder-3.jpg", alt: "Brand logos", aspect: "1/1" } },
  { id: "references", label: "References", media: { src: "grid/slot-2.jpg", alt: "Creative references", aspect: "1/1" } },
  { id: "products", label: "Product Images", media: { src: "grid/slot-1.jpg", alt: "Product photography", aspect: "1/1" } },
];

// Demo Brief content shown before "Generate Design" -- styled to match
// Brief's own visual language (see stage-02-create.tsx), not the real
// BriefBoard/TaskCard component: generateBriefDesign is called directly
// from inside that component with no prop-injection point (unlike
// AnnotationEditor's swappable saveAction), so reusing it live would mean
// either firing a real Anthropic call from an anonymous visitor or
// refactoring a real server-action call site just for this -- out of scope
// here. The Brief card is new landing-only markup instead.
export const DEMO_BRIEF_TASK = {
  name: "Product Launch — Reel Cover",
  frames: [
    { label: "COVER", body: "New. Now available." },
    { label: "BODY", body: "Small batch. Big difference." },
  ],
};

// The base photo the canned layout composes over, with its real natural
// pixel dimensions -- layoutToFabricJson's cover-fit math needs the true
// aspect ratio to size/position correctly, not a guess.
export const DEMO_DESIGN_CANVAS_W = 1080;
export const DEMO_DESIGN_CANVAS_H = 1350;
const CANVAS_W = DEMO_DESIGN_CANVAS_W;
const CANVAS_H = DEMO_DESIGN_CANVAS_H;
export const DEMO_DESIGN_BASE_PHOTO = {
  src: landingMediaUrl("grid/slot-1.jpg"),
  naturalW: 1080,
  naturalH: 1350,
};

// Hand-authored "AI output" -- fractional x/y/w/h elements in exactly the
// shape a real Claude layout response would parse into (see
// src/lib/ai/design-layout.ts's DesignLayoutElement), just written by hand
// instead of generated, since a real AI call should never fire from an
// anonymous landing-page visitor. Converted through the SAME deterministic,
// already-tested layoutToFabricJson() the real Generate Design pipeline
// uses -- not a hand-typed approximation of its output -- so this is
// guaranteed to load via AnnotationEditor's normal canvas.loadFromJSON()
// exactly like a real generation would, as genuinely separate, selectable,
// editable layers, not a flattened image.
export const DEMO_LAYOUT_ELEMENTS: DesignLayoutElement[] = [
  {
    type: "text",
    x: 0.08,
    y: 0.72,
    w: 0.84,
    h: 0.12,
    text: "New. Now available.",
    fontSize: 64,
    color: "#ffffff",
    fontWeight: "bold",
    align: "left",
  },
  { type: "shape", shape: "rect", x: 0.08, y: 0.06, w: 0.22, h: 0.05, fill: "#ffffff", stroke: "transparent" },
];

export const DEMO_DESIGN_FABRIC_JSON = layoutToFabricJson(
  DEMO_LAYOUT_ELEMENTS,
  CANVAS_W,
  CANVAS_H,
  DEMO_DESIGN_BASE_PHOTO,
  new Map(),
);

// Demo Grid rows fed into the real GridBoard (demoMode). "slot-3" starts
// empty -- where the generated design lands once the sequence reaches that
// beat (stage-02-create.tsx swaps this array's slot-3 fields, same
// prop-swap pattern Chapter 01 already uses for its matched-search view).
// "slot-2" carries assetCount:2 so Grid's own real multi-asset badge stands
// in for "Carousel" -- no bespoke carousel-building UI needed.
export const DEMO_GRID_ROWS: GridBoardRow[] = [
  {
    id: "row-1",
    slots: [
      {
        id: "slot-1",
        postId: "post-1",
        thumbnailUrl: landingMediaUrl("grid/slot-3.jpg"),
        coverMediaType: "image",
        coverMediaAssetId: "asset-1",
        coverOriginalUrl: landingMediaUrl("grid/slot-3.jpg"),
        assetCount: 1,
        coverTransform: null,
        scheduledDate: "2026-08-20",
      },
      {
        id: "slot-2",
        postId: "post-2",
        thumbnailUrl: landingMediaUrl("grid/slot-4.jpg"),
        coverMediaType: "image",
        coverMediaAssetId: "asset-2",
        coverOriginalUrl: landingMediaUrl("grid/slot-4.jpg"),
        assetCount: 2,
        coverTransform: null,
        scheduledDate: null,
      },
      {
        id: "slot-3",
        postId: null,
        thumbnailUrl: null,
        coverMediaType: null,
        coverMediaAssetId: null,
        coverOriginalUrl: null,
        assetCount: 0,
        coverTransform: null,
        scheduledDate: null,
      },
    ],
  },
  {
    id: "row-2",
    slots: [
      {
        id: "slot-4",
        postId: "post-4",
        thumbnailUrl: landingMediaUrl("grid/slot-5.jpg"),
        coverMediaType: "image",
        coverMediaAssetId: "asset-4",
        coverOriginalUrl: landingMediaUrl("grid/slot-5.jpg"),
        assetCount: 1,
        coverTransform: null,
        scheduledDate: null,
      },
      {
        id: "slot-5",
        postId: "post-5",
        thumbnailUrl: landingMediaUrl("grid/slot-6.jpg"),
        coverMediaType: "image",
        coverMediaAssetId: "asset-5",
        coverOriginalUrl: landingMediaUrl("grid/slot-6.jpg"),
        assetCount: 1,
        coverTransform: null,
        scheduledDate: null,
      },
      {
        id: "slot-6",
        postId: "post-6",
        thumbnailUrl: landingMediaUrl("export/feed-3.jpg"),
        coverMediaType: "image",
        coverMediaAssetId: "asset-6",
        coverOriginalUrl: landingMediaUrl("export/feed-3.jpg"),
        assetCount: 1,
        coverTransform: null,
        scheduledDate: null,
      },
    ],
  },
];
