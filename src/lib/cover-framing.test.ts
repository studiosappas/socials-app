// Tests for cover-framing.ts. Run with:
//   node --experimental-strip-types src/lib/cover-framing.test.ts
// The rendered-export half (real plan + renderer, legacy vs marked, against
// Production's plan) is scripts/post-export.check.mjs part D.

import assert from "node:assert/strict";
import {
  GRID_PREVIEW_SCOPE,
  GRID_PREVIEW_SCOPE_VERSION,
  exportCoverFraming,
  isGridPreviewFraming,
  markGridPreviewFraming,
  sameFraming,
} from "./cover-framing.ts";

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

const LEGACY = { scale: 1.6, x: 0.08, y: -0.05, rotation: 0 };

test("the marker shape is exactly { scope: 'grid-preview', scopeVersion: 1 } on top of the framing", () => {
  const marked = markGridPreviewFraming(LEGACY);
  assert.deepEqual(marked, { ...LEGACY, scope: "grid-preview", scopeVersion: 1 });
  assert.equal(GRID_PREVIEW_SCOPE, "grid-preview");
  assert.equal(GRID_PREVIEW_SCOPE_VERSION, 1);
  // the input isn't mutated
  assert.equal("scope" in LEGACY, false);
  // survives a JSONB round trip
  assert.equal(isGridPreviewFraming(JSON.parse(JSON.stringify(marked))), true);
});

test("unmarked legacy framing keeps cropping exports, untouched", () => {
  assert.equal(isGridPreviewFraming(LEGACY), false);
  assert.equal(exportCoverFraming(LEGACY), LEGACY);
  assert.equal(exportCoverFraming({ scale: 2, x: 0, y: 0 }) !== null, true, "rotation-less legacy shape too");
});

test("marked framing never crops exports", () => {
  assert.equal(exportCoverFraming(markGridPreviewFraming(LEGACY)), null);
});

test("missing / malformed / unknown markers are LEGACY (fail-safe: old exports never change)", () => {
  const variants: object[] = [
    { ...LEGACY, scope: "grid-preview" }, // no version
    { ...LEGACY, scope: "grid-preview", scopeVersion: 2 }, // unknown version
    { ...LEGACY, scope: "grid-preview", scopeVersion: "1" }, // wrong type
    { ...LEGACY, scope: "Grid-Preview", scopeVersion: 1 }, // case
    { ...LEGACY, scope: "export", scopeVersion: 1 }, // unknown scope
    { ...LEGACY, scope: null, scopeVersion: 1 },
    { ...LEGACY, scopeVersion: 1 },
  ];
  for (const v of variants) {
    assert.equal(isGridPreviewFraming(v), false, JSON.stringify(v));
    assert.equal(exportCoverFraming(v), v, JSON.stringify(v));
  }
  for (const v of [null, undefined, "grid-preview", 42, []]) assert.equal(isGridPreviewFraming(v), false);
  assert.equal(exportCoverFraming(null), null);
  assert.equal(exportCoverFraming(undefined), null);
});

test("sameFraming: an untouched Crop (open + close) is detected, so nothing is rewritten or marked", () => {
  assert.equal(sameFraming(LEGACY, { ...LEGACY }), true);
  assert.equal(sameFraming(LEGACY, markGridPreviewFraming(LEGACY)), true, "the marker itself isn't a framing change");
  assert.equal(sameFraming({ scale: 2, x: 0, y: 0 }, { scale: 2, x: 0, y: 0, rotation: 0 }), true, "missing rotation == 0");
  assert.equal(sameFraming({ scale: 1, x: 0, y: 0, rotation: 360 }, { scale: 1, x: 0, y: 0, rotation: 0 }), true);
  assert.equal(sameFraming(null, null), true);
  assert.equal(sameFraming(undefined, null), true);
});

test("sameFraming: any real change is a new crop", () => {
  assert.equal(sameFraming(LEGACY, { ...LEGACY, scale: 1.61 }), false);
  assert.equal(sameFraming(LEGACY, { ...LEGACY, x: 0.081 }), false);
  assert.equal(sameFraming(LEGACY, { ...LEGACY, y: 0 }), false);
  assert.equal(sameFraming(LEGACY, { ...LEGACY, rotation: 5 }), false);
  // cropping a never-framed cover (null -> zoom 1, centred) is a new crop
  assert.equal(sameFraming(null, { scale: 1, x: 0, y: 0, rotation: 0 }), false);
});

console.log(`\n${passed} tests passed`);
