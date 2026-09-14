"use client";

// A small session-scoped "copy style / paste style" clipboard for Grid's
// per-slot ⋮ menu. Two independent, sessionStorage-backed pieces of state:
//
// 1. The clipboard itself (useCopiedStyle/setCopiedStyle) -- what "Copy
//    style" last captured, readable by any slot's "Paste style" button.
// 2. A tiny per-post staging area (stagePendingStylePaste/
//    takePendingStylePaste) -- Text and Adjustments have no independent,
//    safely-instant-writable storage (see extract*/apply* below), so a
//    paste of either defers to the next time that post's cover image is
//    opened in the Image Editor, where it's blended into the canvas the
//    user already reviews and explicitly Saves -- the same guarantee every
//    other edit in that editor already has, with no new headless-render
//    infrastructure and no risk of silently rewriting a media asset that
//    may be the cover of more than one post (see saveMediaAssetAnnotation's
//    own comment on that sharing).
//
// sessionStorage (not localStorage) deliberately -- "the same working
// session," cleared when the tab closes, never a permanent cross-session
// preset/brand-style store.

import { useSyncExternalStore } from "react";
import { readAdjustments, type AdjustmentValues } from "@/lib/image-adjustments";
import type { GridCoverTransform } from "@/app/projects/[projectId]/grid/grid-reducer";

export type StyleCategory = "crop" | "text" | "adjustments";

// Deliberately style-only -- no `text` (content) and no position/scale
// fields. Position/scale would create a "duplicate layout" behavior that's
// a different feature from copying styling (see this project's own task
// notes on that distinction), so it's left out entirely rather than guessed
// at.
export type CopiedTextStyle = {
  fontFamily: string;
  fontSize: number;
  fontWeight: string | number;
  fontStyle: string;
  fill: string;
  textAlign: string;
  charSpacing?: number;
  lineHeight?: number;
};

export type CopiedPostStyle = {
  sourcePostId: string;
  categories: StyleCategory[];
  crop?: GridCoverTransform | null;
  text?: CopiedTextStyle;
  adjustments?: AdjustmentValues;
};

export type PendingStylePaste = {
  text?: CopiedTextStyle;
  adjustments?: AdjustmentValues;
};

const CLIPBOARD_KEY = "flower:copied-post-style";
const PENDING_KEY = "flower:pending-style-paste";

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

function readPendingMap(): Record<string, PendingStylePaste> {
  if (typeof window === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    return raw ? (JSON.parse(raw) as Record<string, PendingStylePaste>) : {};
  } catch {
    return {};
  }
}

function writePendingMap(map: Record<string, PendingStylePaste>) {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(map));
  } catch {
    // ignore -- see setCopiedStyle
  }
}

export function stagePendingStylePaste(postId: string, paste: PendingStylePaste) {
  const map = readPendingMap();
  map[postId] = paste;
  writePendingMap(map);
}

// "Take" (read + clear in one step), not "get" -- a staged paste is meant to
// apply exactly once, the next time this post's cover is opened in the
// Image Editor, not every time.
export function takePendingStylePaste(postId: string): PendingStylePaste | null {
  const map = readPendingMap();
  const entry = map[postId];
  if (!entry) return null;
  delete map[postId];
  writePendingMap(map);
  return entry;
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

// Same idea for Text style -- uses the first IText object in the canvas's
// object stack (paint order) as "the" text style for this asset. There's no
// other signal available outside a live editing session (e.g. "the
// currently selected one"), and a post's cover art in this app typically
// carries at most one text treatment, so this is a simple, deterministic
// default rather than an attempt to model multiple independent text styles.
export function extractTextStyleFromAnnotationJson(json: object | null): CopiedTextStyle | null {
  const objects = (json as RawAnnotationJson | null)?.objects;
  const text = objects?.find((o) => o.type === "IText");
  if (!text) return null;
  const style: CopiedTextStyle = {
    fontFamily: (text.fontFamily as string) ?? "Arial, Helvetica, sans-serif",
    fontSize: (text.fontSize as number) ?? 22,
    fontWeight: (text.fontWeight as string | number) ?? "normal",
    fontStyle: (text.fontStyle as string) ?? "normal",
    fill: (text.fill as string) ?? "#171412",
    textAlign: (text.textAlign as string) ?? "left",
  };
  if (typeof text.charSpacing === "number") style.charSpacing = text.charSpacing;
  if (typeof text.lineHeight === "number") style.lineHeight = text.lineHeight;
  return style;
}

// NOTE: the paste-side "apply" step deliberately does NOT live here.
// AnnotationEditor itself applies a PendingStylePaste (see its own
// pendingStyleToApply prop), once, right after its own normal load
// finishes -- never by pre-mutating a post's annotation_json before the
// editor ever sees it. An earlier version of this file did exactly that,
// and it broke a common, ordinary case: an asset with no prior
// annotation_json at all (json === null, the signal AnnotationEditor uses
// to take its "fresh load from imageUrl" path) turned into a non-null-but-
// empty {objects: []} once "patched" -- which the editor's own
// initialization reads as "there IS saved state to restore," loading a
// blank canvas with no base photo at all instead of the real image. Never
// reintroduce a JSON-patching version of this function; extend
// AnnotationEditor's own post-load application instead.
