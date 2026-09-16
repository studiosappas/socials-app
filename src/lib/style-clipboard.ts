"use client";

// A small session-scoped "copy style" clipboard for Grid's per-slot ⋮ menu
// -- what "Copy style" last captured, readable by any slot's "Paste style"
// button. sessionStorage (not localStorage) deliberately -- "the same
// working session," cleared when the tab closes, never a permanent cross-
// session preset/brand-style store.
//
// Paste itself is a direct, synchronous Grid mutation (see grid-board.tsx's
// handlePasteStyle) -- there is no queue here for it to consume later. An
// earlier version of this feature staged Text/Adjustments pastes here and
// had Paste Style navigate to Post Editor to apply them; that's gone. See
// this file's own git history if that mechanism is ever needed again, but
// prefer extending the direct-paste path in grid-board.tsx instead.

import { useSyncExternalStore } from "react";
import { readAdjustments, type AdjustmentValues } from "@/lib/image-adjustments";
import { recoverSourceFrameHeight } from "@/lib/annotation-engine";
import type { GridCoverTransform } from "@/app/projects/[projectId]/grid/grid-reducer";
import { GRID_COVER_RATIO_W, GRID_COVER_RATIO_H } from "@/app/projects/[projectId]/grid/grid-constants";

export type StyleCategory = "crop" | "text" | "adjustments";

// "Text" means the complete textual visual content of every text object on
// the source's cover, not just a style to reapply to something else: the
// literal words, every per-character/whole-object Fabric property
// (font/size/color/weight/style/alignment/lineHeight/charSpacing), and its
// full geometry (position/scale/rotation/opacity). Pasting always ADDS
// these as new, independent objects on the target -- see
// annotation-engine.ts's pasteTextObjectsOntoCanvas -- never restyles or
// replaces anything the target already has. Kept as the raw Fabric object
// JSON (not a hand-picked field list) specifically so nothing the editor's
// object model supports today silently gets dropped in the copy.
export type CopiedTextObject = Record<string, unknown>;

export type CopiedPostStyle = {
  sourcePostId: string;
  categories: StyleCategory[];
  crop?: GridCoverTransform | null;
  // ALL text objects found on the source (not just the first) -- see
  // extractTextObjectsFromAnnotationJson below -- plus the frame height
  // they were positioned/sized against, so a paste onto a differently-
  // sized target canvas can rescale position/fontSize proportionally
  // instead of copying raw pixel coordinates (see
  // annotation-engine.ts's recoverSourceFrameHeight).
  text?: { objects: CopiedTextObject[]; sourceFrameH: number | null };
  adjustments?: AdjustmentValues;
};

const CLIPBOARD_KEY = "flower:copied-post-style";

let cachedClipboard: CopiedPostStyle | null | undefined;
const clipboardListeners = new Set<() => void>();

function readClipboardFromStorage(): CopiedPostStyle | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(CLIPBOARD_KEY);
    return raw ? (JSON.parse(raw) as CopiedPostStyle) : null;
  } catch {
    return null;
  }
}

function getClipboardSnapshot(): CopiedPostStyle | null {
  if (cachedClipboard === undefined) cachedClipboard = readClipboardFromStorage();
  return cachedClipboard ?? null;
}

function getServerClipboardSnapshot(): CopiedPostStyle | null {
  return null;
}

function subscribeClipboard(listener: () => void) {
  clipboardListeners.add(listener);
  return () => clipboardListeners.delete(listener);
}

export function setCopiedStyle(style: CopiedPostStyle | null) {
  cachedClipboard = style;
  try {
    if (style) sessionStorage.setItem(CLIPBOARD_KEY, JSON.stringify(style));
    else sessionStorage.removeItem(CLIPBOARD_KEY);
  } catch {
    // sessionStorage unavailable (private mode / quota) -- the in-memory
    // cache above still works for the rest of this tab's lifetime, it just
    // won't survive a remount.
  }
  clipboardListeners.forEach((listener) => listener());
}

// Matches this codebase's existing useIsTouchDevice singleton-store
// convention (module-level cache + useSyncExternalStore) rather than a new
// Context provider -- there's exactly one clipboard, global to the tab.
export function useCopiedStyle(): CopiedPostStyle | null {
  return useSyncExternalStore(subscribeClipboard, getClipboardSnapshot, getServerClipboardSnapshot);
}

type RawFabricObject = { type?: string; appRole?: string; [key: string]: unknown };
type RawAnnotationJson = { objects?: RawFabricObject[] };

// Reads Adjustments straight off a saved annotation_json blob (see
// saveMediaAssetAnnotation) with no live Fabric canvas involved -- "Copy
// style" needs to read a source post's cover asset even when that post
// isn't open in the editor at all.
export function extractAdjustmentsFromAnnotationJson(json: object | null): AdjustmentValues | null {
  const objects = (json as RawAnnotationJson | null)?.objects;
  const basePhoto = objects?.find((o) => o.appRole === "basePhoto");
  if (!basePhoto) return null;
  return readAdjustments(basePhoto.filters as { type?: string }[] | undefined);
}

// "Text" is the COMPLETE textual visual content of the source -- every text
// object found (IText/Text/Textbox, in paint order), each carrying its
// literal words and full raw Fabric object JSON (font, per-character
// styles, color, alignment, position, scale, rotation, opacity, line
// height, everything toJSON() persists), not a hand-picked style subset.
// Returns null only when the source has no text object at all; a source
// with several returns ALL of them -- pasting adds every one as an
// independent object on the target, never just the first (see
// annotation-engine.ts's pasteTextObjectsOntoCanvas).
export function extractTextObjectsFromAnnotationJson(
  json: object | null,
): { objects: Record<string, unknown>[]; sourceFrameH: number | null } | null {
  const objects = (json as RawAnnotationJson | null)?.objects;
  const textObjects = (objects ?? []).filter(
    (o) => o.type === "IText" || o.type === "Text" || o.type === "Textbox",
  );
  if (textObjects.length === 0) return null;
  const sourceFrameH = json
    ? recoverSourceFrameHeight(json, { w: GRID_COVER_RATIO_W, h: GRID_COVER_RATIO_H })
    : null;
  return { objects: textObjects, sourceFrameH };
}
