// Tests for annotation-frame.ts -- no Fabric, no DOM. Run with:
//   node --experimental-strip-types src/lib/annotation-frame.test.ts
//
// Fixtures are built the way AnnotationEditor actually places its base
// photo (initial cover-fit load, Apply crop, freeform-rotation crop) on a
// frame of a known size, so "recovered frame == the frame it was built on"
// is checked against an independent construction, not the formula itself.

import assert from "node:assert/strict";
import {
  isLegacy34Restore,
  planAnnotationRestore,
  proposeReframeWindow,
  recoverSavedFrame,
  reframeBlockers,
  rescaleAnnotationJson,
  sameBaseFraming,
} from "./annotation-frame.ts";
import { annotationCropStateFromWindow } from "./crop-geometry.ts";

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    throw err;
  }
}

const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

// A frame the editor would build: height = its display cap, width by aspect.
const frameOf = (aspect: { w: number; h: number }, height = 640) => ({ width: (height * aspect.w) / aspect.h, height });

// AnnotationEditor's initial load: cover-fit, centred, origin top-left.
function coverFitPhoto(frame: { width: number; height: number }, natural: { w: number; h: number }) {
  const s = Math.max(frame.width / natural.w, frame.height / natural.h);
  return {
    type: "Image",
    appRole: "basePhoto",
    originX: "left",
    originY: "top",
    width: natural.w,
    height: natural.h,
    cropX: 0,
    cropY: 0,
    scaleX: s,
    scaleY: s,
    left: (frame.width - natural.w * s) / 2,
    top: (frame.height - natural.h * s) / 2,
  };
}
// AnnotationEditor's Apply crop: a window of the frame's aspect, filling it at 0,0.
function croppedPhoto(frame: { width: number; height: number }, natural: { w: number; h: number }, cropW: number) {
  const cropH = (cropW * frame.height) / frame.width;
  return {
    type: "Image",
    appRole: "basePhoto",
    originX: "left",
    originY: "top",
    width: cropW,
    height: cropH,
    cropX: (natural.w - cropW) / 3,
    cropY: (natural.h - cropH) / 4,
    scaleX: frame.width / cropW,
    scaleY: frame.height / cropH,
    left: 0,
    top: 0,
  };
}
const text = (left: number, top: number) => ({ type: "IText", text: "Hi", left, top, scaleX: 1, scaleY: 1, fontSize: 22 });

const ASPECTS = { cover34: { w: 3, h: 4 }, feed45: { w: 4, h: 5 }, reel916: { w: 9, h: 16 } };
const SOURCES = [{ w: 4000, h: 3000 }, { w: 1080, h: 1920 }, { w: 2000, h: 2000 }, { w: 1080, h: 1350 }];

test("recovers the exact saved frame for every placement the editor produces, at every app aspect and source shape", () => {
  for (const aspect of Object.values(ASPECTS)) {
    for (const height of [640, 503.25, 240]) {
      const frame = frameOf(aspect, height);
      for (const natural of SOURCES) {
        for (const photo of [coverFitPhoto(frame, natural), croppedPhoto(frame, natural, natural.w / 2)]) {
          const got = recoverSavedFrame({ objects: [photo, text(10, 10)] });
          assert.ok(got, `recovered at ${JSON.stringify({ aspect, height, natural })}`);
          assert.ok(close(got!.width, frame.width) && close(got!.height, frame.height), `${JSON.stringify(got)} vs ${JSON.stringify(frame)}`);
        }
      }
    }
  }
});

test("legacy canvas.backgroundImage shape and a genuinely centre-origin photo are recovered too", () => {
  const frame = frameOf(ASPECTS.cover34, 600);
  const photo = coverFitPhoto(frame, { w: 4000, h: 3000 });
  assert.deepEqual(recoverSavedFrame({ objects: [], backgroundImage: photo }), { width: frame.width, height: frame.height });
  const centred = { ...photo, originX: "center", originY: "center", left: frame.width / 2, top: frame.height / 2 };
  const got = recoverSavedFrame({ objects: [centred] })!;
  assert.ok(close(got.width, frame.width) && close(got.height, frame.height));
});

test("undeterminable inputs return null (callers keep their previous behaviour) -- never a guessed frame", () => {
  assert.equal(recoverSavedFrame(null), null);
  assert.equal(recoverSavedFrame({ objects: [text(1, 1)] }), null, "no base photo");
  assert.equal(recoverSavedFrame({ objects: [{ appRole: "basePhoto", width: 0, height: 10 }] }), null);
  // the pre-fix centre-origin bug: top-left maths on a centre-origin object -> implies a non-positive frame
  const frame = frameOf(ASPECTS.cover34);
  const buggy = { ...coverFitPhoto(frame, { w: 4000, h: 3000 }), originX: "center", originY: "center" };
  assert.equal(recoverSavedFrame({ objects: [buggy] }), null);
  // a photo that doesn't cover the frame it implies isn't an editor placement
  assert.equal(recoverSavedFrame({ objects: [{ appRole: "basePhoto", width: 100, height: 100, scaleX: 1, scaleY: 1, left: 20, top: 0 }] }), null);
});

test("legacy 3:4 edit reopened where the target is now 4:5 (or 9:16): KEEPS its saved 3:4 frame -- never recropped", () => {
  const frame = frameOf(ASPECTS.cover34, 600);
  const json = { objects: [croppedPhoto(frame, { w: 4000, h: 3000 }, 1200), text(30, 40)] };
  for (const target of [ASPECTS.feed45, ASPECTS.reel916]) {
    const plan = planAnnotationRestore(json, target);
    assert.equal(plan.keptSavedAspect, true);
    assert.ok(close(plan.aspect.w / plan.aspect.h, 0.75), JSON.stringify(plan.aspect));
    assert.ok(close(plan.savedHeight!, 600));
  }
});

test("an edit saved at the target's own aspect restores at the target (only the working size may differ)", () => {
  for (const aspect of Object.values(ASPECTS)) {
    const json = { objects: [coverFitPhoto(frameOf(aspect, 512), { w: 4000, h: 3000 })] };
    const plan = planAnnotationRestore(json, aspect);
    assert.equal(plan.keptSavedAspect, false);
    assert.deepEqual(plan.aspect, aspect);
    assert.ok(close(plan.savedHeight!, 512));
  }
  // no recoverable frame: the target, unchanged, and nothing to rescale from
  assert.deepEqual(planAnnotationRestore(null, ASPECTS.feed45), { aspect: ASPECTS.feed45, keptSavedAspect: false, savedHeight: null });
});

test("rescale: saved at 512px tall, reopened at 640px -- every object keeps its RELATIVE position and size; input untouched", () => {
  const frame = frameOf(ASPECTS.feed45, 512);
  const photo = croppedPhoto(frame, { w: 4000, h: 3000 }, 1600);
  const json = { version: "7", objects: [photo, text(100, 200), { type: "Group", left: 50, top: 60, scaleX: 2, scaleY: 1.5, angle: 30 }] };
  const before = JSON.stringify(json);
  const ratio = 640 / 512;
  const out = rescaleAnnotationJson(json, ratio);
  assert.equal(JSON.stringify(json), before, "input not mutated");
  // the photo fills the NEW frame exactly, same crop window
  const p = out.objects[0] as typeof photo;
  assert.ok(close(p.width * p.scaleX, frame.width * ratio) && close(p.height * p.scaleY, 640));
  assert.equal(p.cropX, photo.cropX);
  assert.equal(p.cropY, photo.cropY);
  // relative positions (fraction of the frame) are unchanged
  const t = out.objects[1] as ReturnType<typeof text>;
  assert.ok(close(t.left / (frame.width * ratio), 100 / frame.width) && close(t.top / 640, 200 / 512));
  assert.ok(close(t.scaleX, ratio), "text grows with the frame");
  const g = out.objects[2] as { left: number; top: number; scaleX: number; scaleY: number; angle: number };
  assert.ok(close(g.scaleX, 2 * ratio) && close(g.scaleY, 1.5 * ratio));
  assert.equal(g.angle, 30, "rotation untouched");
  // and the rescaled JSON recovers to the new frame
  const rec = recoverSavedFrame(out)!;
  assert.ok(close(rec.height, 640) && close(rec.width, frame.width * ratio));
  // ratio 1 is a no-op that returns the same object
  assert.equal(rescaleAnnotationJson(json, 1), json);
});

// --- Re-frame to 4:5 ------------------------------------------------------

test("re-frame is offered only for an older 3:4 frame reopened where new edits are 4:5", () => {
  const legacy = { objects: [croppedPhoto(frameOf(ASPECTS.cover34), { w: 4000, h: 3000 }, 1200)] };
  assert.equal(isLegacy34Restore(planAnnotationRestore(legacy, ASPECTS.feed45), ASPECTS.feed45), true);
  // already 4:5, a 9:16 target, no restore, unreadable: not offered
  const new45 = { objects: [croppedPhoto(frameOf(ASPECTS.feed45), { w: 4000, h: 3000 }, 1200)] };
  assert.equal(isLegacy34Restore(planAnnotationRestore(new45, ASPECTS.feed45), ASPECTS.feed45), false);
  assert.equal(isLegacy34Restore(planAnnotationRestore(legacy, ASPECTS.reel916), ASPECTS.reel916), false);
  assert.equal(isLegacy34Restore(null, ASPECTS.feed45), false);
  assert.equal(isLegacy34Restore(planAnnotationRestore({ objects: [] }, ASPECTS.feed45), ASPECTS.feed45), false);
});

test("re-frame blockers: text/drawings/logos and in-place photo changes block it; adjustments alone don't", () => {
  const photo = croppedPhoto(frameOf(ASPECTS.cover34), { w: 4000, h: 3000 }, 1200);
  assert.deepEqual(reframeBlockers({ objects: [{ ...photo, src: "https://x/orig.png", filters: [{ type: "Brightness", brightness: 0.1 }] }] }), []);
  assert.deepEqual(reframeBlockers({ objects: [photo, text(10, 10)] }), ["objects"]);
  assert.deepEqual(reframeBlockers({ objects: [{ ...photo, src: "data:image/jpeg;base64,AAAA" }] }), ["baked-pixels"]);
  assert.deepEqual(reframeBlockers({ objects: [{ ...photo, src: "data:image/png;base64,AA" }, { type: "Path" }] }), ["objects", "baked-pixels"]);
  assert.deepEqual(reframeBlockers({ objects: [text(1, 1)] }), ["unreadable"]);
  // legacy backgroundImage shape with nothing else: eligible
  assert.deepEqual(reframeBlockers({ objects: [], backgroundImage: { ...photo, src: "https://x/o.png" } }), []);
});

// Oracle: AnnotationEditor's window math (handleApplyCrop / applyReframe).
function windowFor(frame: { w: number; h: number }, natural: { w: number; h: number }, zoom: number, offset: { x: number; y: number }) {
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
  const cs = Math.max(frame.w / natural.w, frame.h / natural.h);
  const cropW = clamp(frame.w / (cs * zoom), 0, natural.w);
  const cropH = clamp(frame.h / (cs * zoom), 0, natural.h);
  return {
    cropW,
    cropH,
    cropX: clamp((natural.w - cropW) / 2 - offset.x * cropW, 0, natural.w - cropW),
    cropY: clamp((natural.h - cropH) / 2 - offset.y * cropH, 0, natural.h - cropH),
  };
}

test("proposed 4:5 framing keeps the saved edit's centre and visible height, over the ORIGINAL photo", () => {
  const natural = { w: 4000, h: 3000 };
  // a legacy 3:4 crop: a 1200 x 1600 window at (1300, 700)
  const legacy = { objects: [{ ...croppedPhoto(frameOf(ASPECTS.cover34, 600), natural, 1200), cropX: 1300, cropY: 700 }] };
  const proposal = proposeReframeWindow(legacy, ASPECTS.feed45)!;
  const state = annotationCropStateFromWindow(proposal.frame, natural, proposal.photo, 4);
  const w = windowFor({ w: 4, h: 5 }, natural, state.zoom, state.offset);
  assert.ok(close(w.cropH, 1600), `height ${w.cropH}`);
  assert.ok(close(w.cropW / w.cropH, 0.8, 1e-9), "4:5");
  assert.ok(close(w.cropX + w.cropW / 2, 1900) && close(w.cropY + w.cropH / 2, 1500), "same centre");
});

test("proposed framing near the photo's edge is clamped inside the photo (never empty space)", () => {
  const natural = { w: 3000, h: 4000 };
  // a full-width 3:4 window at the top: widening to 4:5 at the same height can't fit
  const legacy = { objects: [{ ...croppedPhoto(frameOf(ASPECTS.cover34, 600), natural, 3000), cropX: 0, cropY: 0 }] };
  const proposal = proposeReframeWindow(legacy, ASPECTS.feed45)!;
  const state = annotationCropStateFromWindow(proposal.frame, natural, proposal.photo, 4);
  const w = windowFor({ w: 4, h: 5 }, natural, state.zoom, state.offset);
  assert.ok(w.cropX >= 0 && w.cropY >= 0 && w.cropX + w.cropW <= natural.w + 1e-6 && w.cropY + w.cropH <= natural.h + 1e-6, JSON.stringify(w));
  assert.ok(close(w.cropW / w.cropH, 0.8, 1e-9));
  assert.ok(state.zoom >= 1);
});

test("an uncropped (cover-fit) 3:4 edit proposes the 4:5 view of the same centred photo", () => {
  const natural = { w: 4000, h: 3000 };
  const legacy = { objects: [coverFitPhoto(frameOf(ASPECTS.cover34, 600), natural)] };
  const proposal = proposeReframeWindow(legacy, ASPECTS.feed45)!;
  const state = annotationCropStateFromWindow(proposal.frame, natural, proposal.photo, 4);
  const w = windowFor({ w: 4, h: 5 }, natural, state.zoom, state.offset);
  assert.ok(close(w.cropH, 3000) && close(w.cropX + w.cropW / 2, 2000), JSON.stringify(w));
});

// --- Edit Cover keeps a valid cover crop (sameBaseFraming) ------------------

const frame916 = frameOf(ASPECTS.reel916);
const frameData = "data:image/jpeg;base64,FRAMEONE";
const reelSave = (photo: object, ...rest: object[]) => ({ objects: [{ ...photo, src: frameData }, ...rest] });

test("Edit Cover: an annotation-only save (text added/moved, adjustments) keeps the cover framing", () => {
  const before = reelSave(croppedPhoto(frame916, { w: 1080, h: 1920 }, 700));
  const after = reelSave({ ...croppedPhoto(frame916, { w: 1080, h: 1920 }, 700), filters: [{ type: "Brightness", brightness: 0.2 }] }, text(40, 60));
  assert.equal(sameBaseFraming(before, after), true);
});

test("Edit Cover: reopened in a different window size (every object rescaled) is still the same framing", () => {
  const before = reelSave(croppedPhoto(frame916, { w: 1080, h: 1920 }, 700), text(40, 60));
  assert.equal(sameBaseFraming(before, rescaleAnnotationJson(before, 0.73)), true);
  assert.equal(sameBaseFraming(before, rescaleAnnotationJson(before, 1.4)), true);
});

test("Edit Cover: a new frame, a Crop Image change, rotate/flip or another aspect changes the framing (crop reset)", () => {
  const photo = croppedPhoto(frame916, { w: 1080, h: 1920 }, 700);
  const before = reelSave(photo);
  assert.equal(sameBaseFraming(before, { objects: [{ ...photo, src: "data:image/jpeg;base64,FRAMETWO" }] }), false, "another picked frame");
  assert.equal(sameBaseFraming(before, reelSave(croppedPhoto(frame916, { w: 1080, h: 1920 }, 600))), false, "Crop Image changed");
  assert.equal(sameBaseFraming(before, reelSave({ ...photo, angle: 90 })), false, "rotated");
  assert.equal(sameBaseFraming(before, reelSave({ ...photo, flipX: true })), false, "flipped");
  assert.equal(sameBaseFraming(before, reelSave({ ...photo, left: 12 })), false, "photo moved");
  const frame34 = frameOf(ASPECTS.cover34);
  assert.equal(sameBaseFraming(before, reelSave(croppedPhoto(frame34, { w: 1080, h: 1920 }, 700))), false, "another aspect");
});

test("Edit Cover: no previous edit (first edit of an automatic poster) or unreadable framing -> reset, never guessed", () => {
  const after = reelSave(croppedPhoto(frame916, { w: 1080, h: 1920 }, 700));
  assert.equal(sameBaseFraming(null, after), false);
  assert.equal(sameBaseFraming({ objects: [] }, after), false);
  assert.equal(sameBaseFraming(after, { objects: [text(1, 1)] }), false);
});

test("Edit Image (signed storage URL): only the object path counts, not the expiring token", () => {
  const photo = { ...coverFitPhoto(frameOf(ASPECTS.feed45), { w: 4000, h: 3000 }) };
  const a = { objects: [{ ...photo, src: "https://x.supabase.co/storage/v1/object/sign/project-media/p/a.png?token=one" }] };
  const b = { objects: [{ ...photo, src: "https://x.supabase.co/storage/v1/object/sign/project-media/p/a.png?token=two" }] };
  const c = { objects: [{ ...photo, src: "https://x.supabase.co/storage/v1/object/sign/project-media/p/other.png?token=one" }] };
  assert.equal(sameBaseFraming(a, b), true);
  assert.equal(sameBaseFraming(a, c), false);
});

console.log(`\n${passed} tests passed`);
