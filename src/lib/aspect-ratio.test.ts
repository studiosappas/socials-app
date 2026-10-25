// Tests for aspect-ratio.ts. Run with:
//   node --experimental-strip-types src/lib/aspect-ratio.test.ts
// The rendered half (real export plan + renderer per ratio, no upscaling) is
// scripts/reel-cover-crop.check.mjs part E.

import assert from "node:assert/strict";
import {
  aspectOptions,
  aspectValue,
  aspectWarning,
  defaultAspectChoice,
  editorAspect,
  parseAspectChoice,
} from "./aspect-ratio.ts";

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

test("only the six stored values parse; anything else is legacy (null)", () => {
  for (const v of ["original", "1:1", "4:5", "5:4", "16:9", "9:16"]) assert.equal(parseAspectChoice(v), v);
  for (const v of [null, undefined, "", "3:4", "2:3", "ORIGINAL", 1]) assert.equal(parseAspectChoice(v), null);
});

test("feed posts offer Original / 1:1 / 4:5 (no 9:16); a Reel cover offers 9:16 first", () => {
  assert.deepEqual(aspectOptions("feed"), ["original", "1:1", "4:5", "5:4", "16:9", "9:16"]);
  assert.deepEqual(aspectOptions("reel"), ["9:16", "4:5", "1:1", "5:4", "16:9", "original"]);
});

test("defaults: a Reel cover 9:16, a feed post none (legacy until chosen)", () => {
  assert.equal(defaultAspectChoice("reel"), "9:16");
  assert.equal(defaultAspectChoice("feed"), null);
});

test("values: fixed ratios; Original = the source's own (never a silent 4:5)", () => {
  assert.equal(aspectValue("1:1", null), 1);
  assert.equal(aspectValue("4:5", null), 0.8);
  assert.equal(aspectValue("9:16", null), 9 / 16);
  assert.equal(aspectValue("16:9", null), 16 / 9);
  assert.equal(aspectValue("5:4", null), 5 / 4);
  assert.equal(aspectValue("original", 768 / 480), 1.6);
  assert.equal(aspectValue("original", null), null);
});

test("warnings: Original outside 1.91:1-4:5 on the feed; any non-9:16 Reel cover", () => {
  assert.equal(aspectWarning("feed", "original", 1.6), null);
  assert.match(aspectWarning("feed", "original", 2.5) ?? "", /outside/);
  assert.match(aspectWarning("feed", "original", 9 / 16) ?? "", /outside/);
  assert.equal(aspectWarning("feed", "4:5", 0.8), null);
  assert.equal(aspectWarning("feed", "5:4", 1.25), null);
  assert.equal(aspectWarning("feed", "16:9", 16 / 9), null);
  assert.match(aspectWarning("feed", "9:16", 9 / 16) ?? "", /9:16 is outside/);
  assert.equal(aspectWarning("reel", "9:16", 9 / 16), null);
  assert.match(aspectWarning("reel", "1:1", 1) ?? "", /9:16/);
});

test("Edit Image's frame follows the chosen ratio; none -> legacy rule (null)", () => {
  assert.deepEqual(editorAspect("4:5", null), { w: 0.8, h: 1 });
  assert.deepEqual(editorAspect("original", 1.6), { w: 1.6, h: 1 });
  assert.equal(editorAspect(null, 1.6), null);
});

console.log(`\n${passed} tests passed`);
