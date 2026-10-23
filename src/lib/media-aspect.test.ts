// Tests for media-aspect.ts. Run with:
//   node --experimental-strip-types src/lib/media-aspect.test.ts

import assert from "node:assert/strict";
import { FEED_ASPECT, REEL_COVER_ASPECT, newEditAspect } from "./media-aspect.ts";

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

test("the ratios are the platform's export sizes: 4:5 = 1080x1350, 9:16 = 1080x1920", () => {
  assert.equal(Math.round((1080 * FEED_ASPECT.h) / FEED_ASPECT.w), 1350);
  assert.equal(Math.round((1080 * REEL_COVER_ASPECT.h) / REEL_COVER_ASPECT.w), 1920);
});

test("a standalone Reel's cover is 9:16", () => {
  assert.deepEqual(newEditAspect("video", 1), REEL_COVER_ASPECT);
});

test("a single image post is 4:5", () => {
  assert.deepEqual(newEditAspect("image", 1), FEED_ASPECT);
});

test("every carousel item is 4:5 -- images and videos, any position", () => {
  for (const count of [2, 3, 10]) {
    assert.deepEqual(newEditAspect("image", count), FEED_ASPECT);
    assert.deepEqual(newEditAspect("video", count), FEED_ASPECT);
  }
});

test("returns the shared constants (stable references for React props)", () => {
  assert.equal(newEditAspect("video", 1), REEL_COVER_ASPECT);
  assert.equal(newEditAspect("image", 4), FEED_ASPECT);
});

console.log(`\n${passed} tests passed`);
