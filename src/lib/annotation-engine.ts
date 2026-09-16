"use client";

// The minimum NON-UI transformation + render + persistence logic shared by
// BOTH the real, visible AnnotationEditor (its own Save button) and Grid's
// direct Paste Style (grid-board.tsx) -- neither mounts the other's UI.
// AnnotationEditor keeps its own DOM-bound <canvas> ref, tool state, undo
// history, and video/frame-picker handling (all genuinely UI concerns with
// no equivalent in a headless paste); it delegates the parts that ARE
// identical between the two -- base-photo tagging, the restore-vs-fresh
// load math, and the export+save tail -- to this module instead of each
// keeping its own copy. Grid's Paste Style builds its own DETACHED canvas
// (a <canvas> element created here, never inserted into the document) and
// calls the same functions directly, with no AnnotationEditor component
// ever mounted, visibly or off-screen.
import * as fabric from "fabric";

export type AnnotationSaveAction = (
  projectId: string,
  targetId: string,
  formData: FormData,
) => Promise<{ previewUrl?: string; message?: string }>;

// The base photo lives as a regular (tagged, non-selectable) object in the
// canvas's own object stack -- see annotation-editor.tsx's own longer
// comment on why (Arrange needs to be able to send things behind it).
// `appRole` only survives toObject()/toJSON() because it's registered as a
// custom property; this must run before any canvas in this app loads or
// saves an annotation, so it's a module-scope side effect here (the one
// place both AnnotationEditor and Grid's headless engine are guaranteed to
// both import).
export const BASE_PHOTO_ROLE = "basePhoto";
fabric.FabricObject.customProperties = ["appRole"];

export type TaggableObject = fabric.FabricObject & { appRole?: string };

export function tagAsBasePhoto(obj: fabric.FabricObject) {
  (obj as TaggableObject).appRole = BASE_PHOTO_ROLE;
}

export function findBasePhoto(canvas: fabric.Canvas): fabric.FabricImage | null {
  const obj = canvas.getObjects().find((o) => (o as TaggableObject).appRole === BASE_PHOTO_ROLE);
  return obj instanceof fabric.FabricImage ? obj : null;
}

// Minimum export pixel width for a targetAspect-locked frame -- handleSave/
// exportAndSaveAnnotation scale up further when the source's native
// resolution at the current crop is larger, so this is a floor, not the
// actual output size. Matches annotation-editor.tsx's own TARGET_EXPORT_W.
export const TARGET_EXPORT_W = 1080;

// A fixed, viewport-INDEPENDENT working frame height for headless canvas
// building (Grid's direct Paste Style has no visible viewport to size
// against, unlike the real editor, which sizes its frame to
// window.innerWidth/innerHeight so a phone doesn't get an oversized
// canvas). The exported image's actual resolution never depends on this
// value (exportAndSaveAnnotation's nativeMultiplier always scales up to the
// source's real resolution) -- it only sets the coordinate space pasted
// objects are positioned/sized in before that final export multiply.
export const HEADLESS_FRAME_H = 1200;

type RawFabricObject = Record<string, unknown> & { type?: string; appRole?: string; src?: string };
type RawAnnotationJson = { objects?: RawFabricObject[]; backgroundImage?: RawFabricObject };

// A saved annotation_json's base photo carries whatever `src` it had at
// save time -- a Supabase SIGNED url that expires (SIGNED_URL_TTL_SECONDS,
// see media.ts). Restoring it any time after that needs the freshly-signed
// url this call was just handed, patched in without touching any other
// saved position/crop/scale value. Same technique for the legacy
// canvas.backgroundImage shape (pre-migration saves).
export function patchRestoredAnnotationSrc(annotationJson: object, freshUrl: string): object {
  const clone = JSON.parse(JSON.stringify(annotationJson)) as RawAnnotationJson;
  const basePhoto = clone.objects?.find((o) => o.appRole === BASE_PHOTO_ROLE);
  if (basePhoto && typeof basePhoto.src === "string" && !basePhoto.src.startsWith("data:")) {
    basePhoto.src = freshUrl;
  }
  if (
    clone.backgroundImage &&
    typeof clone.backgroundImage.src === "string" &&
    !clone.backgroundImage.src.startsWith("data:")
  ) {
    clone.backgroundImage.src = freshUrl;
  }
  return clone;
}

/**
 * Builds a fully-loaded Fabric canvas for one cover asset, bound to a
 * DETACHED <canvas> element (created here, never appended to the
 * document -- nothing is mounted, on-screen or off-screen). Either
 * restores the asset's saved annotation_json (patching the base photo's
 * src to a fresh signed url) or, when it has never been annotated, loads
 * fresh from imageUrl with the same cover-fit framing AnnotationEditor's
 * own load effect uses for a targetAspect-locked frame.
 */
export async function buildAnnotationCanvas(opts: {
  imageUrl: string;
  annotationJson: object | null;
  targetAspect: { w: number; h: number };
  frameH?: number;
}): Promise<{ canvas: fabric.Canvas; exportScale: number; frameH: number }> {
  const { imageUrl, annotationJson, targetAspect, frameH = HEADLESS_FRAME_H } = opts;
  const canvasH = frameH;
  const canvasW = frameH * (targetAspect.w / targetAspect.h);
  const exportScale = TARGET_EXPORT_W / canvasW;

  const el = document.createElement("canvas");
  const canvas = new fabric.Canvas(el, { backgroundColor: "#ffffff", selection: false });
  canvas.setDimensions({ width: canvasW, height: canvasH });

  if (annotationJson) {
    const patched = patchRestoredAnnotationSrc(annotationJson, imageUrl);
    await canvas.loadFromJSON(patched);
    // Migrates the legacy canvas.backgroundImage shape into a regular
    // tagged object, same as annotation-editor.tsx's own restore branch.
    if (canvas.backgroundImage) {
      const legacyPhoto = canvas.backgroundImage as fabric.FabricImage;
      canvas.backgroundImage = undefined;
      legacyPhoto.set({ selectable: false, evented: false });
      tagAsBasePhoto(legacyPhoto);
      canvas.add(legacyPhoto);
      canvas.sendObjectToBack(legacyPhoto);
    }
    canvas.requestRenderAll();
    return { canvas, exportScale, frameH };
  }

  const img = await fabric.FabricImage.fromURL(imageUrl, { crossOrigin: "anonymous" });
  const naturalW = img.width ?? canvasW;
  const naturalH = img.height ?? canvasH;
  const imgScale = Math.max(canvasW / naturalW, canvasH / naturalH);
  img.scale(imgScale);
  img.set({
    left: (canvasW - naturalW * imgScale) / 2,
    top: (canvasH - naturalH * imgScale) / 2,
    selectable: false,
    evented: false,
    originX: "left",
    originY: "top",
  });
  tagAsBasePhoto(img);
  canvas.add(img);
  canvas.requestRenderAll();
  return { canvas, exportScale, frameH };
}

/**
 * Flattens+exports the canvas exactly like AnnotationEditor's own Save
 * (same JPEG quality, same native-resolution multiplier derived from the
 * base photo's current scale, same 19MB pre-flight size check, same 60s
 * timeout), and submits it through the SAME canonical saveAction. This is
 * the actual "persistence" half of "render + persist," used verbatim by
 * both the visible editor's Save button and Grid's headless Paste Style --
 * exactly one code path ever writes an edited cover through to
 * media_assets.
 */
export async function exportAndSaveAnnotation(opts: {
  canvas: fabric.Canvas;
  exportScale: number;
  projectId: string;
  attachmentId: string;
  saveAction: AnnotationSaveAction;
}): Promise<{ previewUrl: string } | { error: string }> {
  const { canvas, exportScale, projectId, attachmentId, saveAction } = opts;
  try {
    const annotationJson = JSON.stringify(canvas.toJSON());
    const basePhoto = findBasePhoto(canvas);
    const nativeMultiplier =
      basePhoto && basePhoto.scaleX ? Math.max(exportScale, 1 / basePhoto.scaleX) : exportScale;
    const blob = await canvas.toBlob({ format: "jpeg", quality: 0.92, multiplier: nativeMultiplier });
    if (!blob) return { error: "Couldn't render the edited image." };
    if (blob.size > 19 * 1024 * 1024) {
      return {
        error: `This image is too large to save at full quality (${(blob.size / 1024 / 1024).toFixed(1)}MB). Try applying a smaller crop and save again.`,
      };
    }
    const formData = new FormData();
    formData.set("file", new File([blob], "annotated-preview.jpg", { type: "image/jpeg" }));
    formData.set("annotation_json", annotationJson);
    const result = await Promise.race([
      saveAction(projectId, attachmentId, formData),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("TIMEOUT")), 60_000)),
    ]);
    if (result.previewUrl) return { previewUrl: result.previewUrl };
    return { error: result.message ?? "Couldn't save changes." };
  } catch (error) {
    return {
      error:
        error instanceof DOMException && error.name === "SecurityError"
          ? "Couldn't save -- an image on this canvas failed to load securely. Try re-adding it and save again."
          : error instanceof Error && error.message === "TIMEOUT"
            ? "Couldn't save -- the connection timed out. Check your connection and try again."
            : "Couldn't save changes. Try again.",
    };
  }
}

export function disposeAnnotationCanvas(canvas: fabric.Canvas) {
  void canvas.dispose();
}

// ---------------------------------------------------------------------
// Text paste: full content + geometry, always additive (see style-clipboard
// .ts's extractTextObjectsFromAnnotationJson for the "what counts as Text"
// half of this).
// ---------------------------------------------------------------------

// Recovers the effective canvas frame HEIGHT a saved annotation_json's base
// photo was originally positioned/sized against. Canvas width/height are
// never themselves stored in toJSON()/loadFromJSON() output (Fabric's own
// documented behavior) -- this reconstructs it from the base photo's own
// recorded width/height/scaleX/scaleY plus the known-fixed targetAspect
// every cover editor session uses (Grid covers are always edited at 3:4).
//
// A cover-fit base photo (initial load, never cropped) always overflows the
// frame on exactly one axis and fits it exactly on the other; a manual crop
// always fills the frame exactly on BOTH axes (this editor has no
// independent X/Y stretch anywhere -- crop-geometry.ts's own zoom model is
// uniform scale only). Either way, the true frame height is the SMALLER of
// the two candidate heights implied by the base photo's width and height
// alone, so this needs no new stored metadata to work retroactively against
// annotation_json saved before this module existed.
export function recoverSourceFrameHeight(
  sourceJson: object | null,
  targetAspect: { w: number; h: number },
): number | null {
  const objects = (sourceJson as RawAnnotationJson | null)?.objects;
  const basePhoto = objects?.find((o) => o.appRole === BASE_PHOTO_ROLE);
  if (!basePhoto) return null;
  const width = basePhoto.width as number | undefined;
  const height = basePhoto.height as number | undefined;
  const scaleX = (basePhoto.scaleX as number | undefined) ?? 1;
  const scaleY = (basePhoto.scaleY as number | undefined) ?? 1;
  if (!width || !height) return null;
  const ar = targetAspect.w / targetAspect.h;
  const fromHeight = scaleY * height;
  const fromWidth = (scaleX * width) / ar;
  const frameH = Math.min(fromHeight, fromWidth);
  return frameH > 0 ? frameH : null;
}

/**
 * Adds independent COPIES of every raw text object onto `canvas` --
 * never mutates or reuses the source's live objects. Each is
 * re-deserialized fresh via fabric.util.enlivenObjects (the same
 * primitive loadFromJSON itself uses internally), so every persisted
 * property -- literal text, per-character styles, font, position, scale,
 * rotation, opacity, line height -- round-trips exactly with no
 * hand-picked property allowlist to fall out of sync with Fabric's own
 * model. Position/size are rescaled from the source's own recovered frame
 * height to this canvas's actual frame height (see recoverSourceFrameHeight)
 * so text lands in the same RELATIVE spot even when the two assets were
 * annotated at different working resolutions -- never blindly copies raw
 * pixel coordinates.
 *
 * Purely additive and never deduplicated: existing objects already on
 * `canvas` (this target's own text, drawings, arrows, shapes) are never
 * read or touched, and calling this twice with the same source objects
 * adds two independent sets, by design.
 */
export async function pasteTextObjectsOntoCanvas(
  canvas: fabric.Canvas,
  rawTextObjects: RawFabricObject[],
  sourceFrameH: number | null,
  targetFrameH: number,
): Promise<void> {
  if (rawTextObjects.length === 0) return;
  const ratio = sourceFrameH && sourceFrameH > 0 ? targetFrameH / sourceFrameH : 1;
  const clones = JSON.parse(JSON.stringify(rawTextObjects)) as RawFabricObject[];
  if (ratio !== 1) {
    for (const raw of clones) {
      if (typeof raw.left === "number") raw.left = raw.left * ratio;
      if (typeof raw.top === "number") raw.top = raw.top * ratio;
      if (typeof raw.fontSize === "number") raw.fontSize = raw.fontSize * ratio;
      if (typeof raw.width === "number") raw.width = raw.width * ratio;
      if (typeof raw.height === "number") raw.height = raw.height * ratio;
    }
  }
  // Never IDs the pasted copy the same as its source -- letting Fabric mint
  // a fresh id (or having none at all) means two paste actions never
  // collide with each other or with the source's own object.
  for (const raw of clones) delete raw.id;
  const enlivened = (await fabric.util.enlivenObjects(clones)) as fabric.FabricObject[];
  for (const obj of enlivened) {
    canvas.add(obj);
  }
  canvas.requestRenderAll();
}
