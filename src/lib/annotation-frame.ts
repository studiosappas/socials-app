// Which frame a SAVED annotation_json was edited in -- pure (no Fabric, no
// DOM), so it runs under Node in annotation-frame.test.ts and is shared by
// AnnotationEditor's restore and annotation-engine.ts's headless restore.
//
// Fabric's toJSON() never stores the canvas size, and every object's
// left/top/scale is absolute in that canvas's units. Two things therefore
// went wrong on reopen:
//   1. SIZE: the canvas is re-sized from the CURRENT window
//      (computeCanvasFrame), so a save made in a bigger/smaller window came
//      back over- or under-sized -- the photo cut off or not filling the
//      frame, text in the wrong place.
//   2. ASPECT: the frame's aspect came from the CURRENT position's rule
//      (cover 3:4, slide 4:5), so an edit saved as a cover and reopened as
//      a slide (or vice versa, after a reorder) was loaded into a frame of a
//      different shape.
//
// Both are recoverable from the base photo alone, retroactively, with no
// stored metadata: the photo always covers the frame and is always placed
// either centred (initial cover-fit load, Rotate/Flip) or at 0,0 filling it
// exactly (Apply crop, freeform-rotation crop) -- the frame is the photo's
// displayed box plus twice its (non-positive) offset on each axis.

const BASE_PHOTO_ROLE = "basePhoto"; // annotation-engine.ts's BASE_PHOTO_ROLE

type RawObject = Record<string, unknown>;
type RawJson = { objects?: RawObject[]; backgroundImage?: RawObject };

export type SavedFrame = { width: number; height: number };

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function findSavedBasePhoto(json: RawJson): RawObject | null {
  return json.objects?.find((o) => o.appRole === BASE_PHOTO_ROLE) ?? json.backgroundImage ?? null;
}

// The frame (canvas units) the annotation was saved in, or null when it
// can't be determined safely -- callers then keep their previous behavior.
export function recoverSavedFrame(annotationJson: object | null | undefined): SavedFrame | null {
  if (!annotationJson) return null;
  const photo = findSavedBasePhoto(annotationJson as RawJson);
  if (!photo) return null;
  const width = num(photo.width, 0);
  const height = num(photo.height, 0);
  const scaleX = num(photo.scaleX, 1);
  const scaleY = num(photo.scaleY, 1);
  const dispW = width * scaleX;
  const dispH = height * scaleY;
  if (!(dispW > 0 && dispH > 0)) return null;
  const left = num(photo.left, 0);
  const top = num(photo.top, 0);
  // A center-origin photo (pre-fix saves defaulted originX/Y to "center")
  // sits at the frame's centre.
  const frameW = photo.originX === "center" ? 2 * left : dispW + 2 * left;
  const frameH = photo.originY === "center" ? 2 * top : dispH + 2 * top;
  if (!(frameW > 0 && frameH > 0)) return null;
  // The photo must actually cover the frame it implies -- anything else
  // isn't one of the placements this editor produces, so don't guess.
  const tolerance = 0.5;
  if (dispW + tolerance < frameW || dispH + tolerance < frameH) return null;
  return { width: frameW, height: frameH };
}

// Relative aspect difference below which a saved frame counts as "the same
// shape" as the target (float noise from serialization). The ratios this
// app uses differ by far more: 3:4 vs 4:5 is ~6.7%, 4:5 vs 9:16 ~42%.
export const SAME_ASPECT_TOLERANCE = 0.01;

export type RestorePlan = {
  // The aspect to build the canvas frame at: the saved frame's own when it
  // differs from the target (a legacy edit keeps its saved shape and
  // framing -- never recropped), else the target unchanged.
  aspect: { w: number; h: number };
  // Whether that aspect is the saved one rather than the requested target.
  keptSavedAspect: boolean;
  // The saved frame's height (canvas units), to rescale saved objects into
  // the frame actually built now; null when it couldn't be recovered.
  savedHeight: number | null;
};

export function planAnnotationRestore(annotationJson: object | null | undefined, targetAspect: { w: number; h: number }): RestorePlan {
  const saved = recoverSavedFrame(annotationJson);
  if (!saved) return { aspect: targetAspect, keptSavedAspect: false, savedHeight: null };
  const savedRatio = saved.width / saved.height;
  const targetRatio = targetAspect.w / targetAspect.h;
  const same = Math.abs(savedRatio / targetRatio - 1) <= SAME_ASPECT_TOLERANCE;
  return {
    aspect: same ? targetAspect : { w: saved.width, h: saved.height },
    keptSavedAspect: !same,
    savedHeight: saved.height,
  };
}

// Uniformly scales every top-level object (and a legacy backgroundImage)
// about the canvas origin by `ratio` -- left/top/scaleX/scaleY only, which
// is exactly how Fabric composes an object's placement, so text, drawings,
// arrows, logos and the photo's crop window all keep their RELATIVE
// position/size. Returns a new object; the input is never mutated. A ratio
// of ~1 returns the input untouched.
export function rescaleAnnotationJson<T extends object>(annotationJson: T, ratio: number): T {
  if (!Number.isFinite(ratio) || ratio <= 0 || Math.abs(ratio - 1) < 1e-9) return annotationJson;
  const clone = JSON.parse(JSON.stringify(annotationJson)) as RawJson;
  const scaleObject = (o: RawObject) => {
    o.left = num(o.left, 0) * ratio;
    o.top = num(o.top, 0) * ratio;
    o.scaleX = num(o.scaleX, 1) * ratio;
    o.scaleY = num(o.scaleY, 1) * ratio;
  };
  clone.objects?.forEach(scaleObject);
  if (clone.backgroundImage) scaleObject(clone.backgroundImage);
  return clone as T;
}
