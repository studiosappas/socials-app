// Tests for library-tile-size.ts. Run with:
//   node --experimental-strip-types src/lib/library-tile-size.test.ts

import assert from "node:assert/strict";
import { libraryTileRowHeight } from "./library-tile-size.ts";

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

test("Content popup at its max-w-3xl cap: 718px, 6 cols, gap 8 -> 9:16 tile is 201px tall", () => {
  assert.equal(libraryTileRowHeight(718, 6, 8, 9 / 16), 201);
});

test("row height tracks the container width, not the item count", () => {
  const narrow = libraryTileRowHeight(600, 6, 8, 9 / 16)!;
  const wide = libraryTileRowHeight(1100, 6, 8, 9 / 16)!;
  assert.ok(wide > narrow);
  // tile stays 9:16 at any width
  for (const width of [600, 718, 1100]) {
    const h = libraryTileRowHeight(width, 6, 8, 9 / 16)!;
    const w = (width - 40) / 6;
    assert.ok(Math.abs(w / h - 9 / 16) < 0.01, `ratio at ${width}`);
  }
});

test("matches Post Editor's own inline 3:4 formula (151px at the same cap)", () => {
  assert.equal(libraryTileRowHeight(718, 6, 8, 3 / 4), 151);
});

test("not-yet-laid-out / nonsensical input returns null so the CSS fallback stays in charge", () => {
  assert.equal(libraryTileRowHeight(0, 6, 8, 9 / 16), null);
  assert.equal(libraryTileRowHeight(-5, 6, 8, 9 / 16), null);
  assert.equal(libraryTileRowHeight(30, 6, 8, 9 / 16), null);
  assert.equal(libraryTileRowHeight(718, 0, 8, 9 / 16), null);
  assert.equal(libraryTileRowHeight(718, 6, 8, 0), null);
  assert.equal(libraryTileRowHeight(Number.NaN, 6, 8, 9 / 16), null);
});

console.log(`\n${passed} tests passed`);
