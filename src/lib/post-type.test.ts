// Tests for post-type.ts's pure rules -- no Supabase. Run with:
//   node --experimental-strip-types src/lib/post-type.test.ts

import assert from "node:assert/strict";
import { derivePostType, exportPostType } from "./post-type.ts";

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

const I = { mediaType: "image" as const };
const V = { mediaType: "video" as const };

test("one image is a Post, one video is a Reel", () => {
  assert.equal(derivePostType([I]), "post");
  assert.equal(derivePostType([V]), "reel");
});

test("two or more items of ANY type are a Carousel -- mixed carousels are never Reels", () => {
  assert.equal(derivePostType([I, I]), "carousel");
  assert.equal(derivePostType([I, V]), "carousel");
  assert.equal(derivePostType([V, I]), "carousel");
  assert.equal(derivePostType([V, V]), "carousel");
  assert.equal(derivePostType([I, V, I, V, I]), "carousel");
});

test("no media yet derives nothing (the stored type is left alone)", () => {
  assert.equal(derivePostType([]), null);
});

test("exportPostType: a stored 'reel' with 2+ items (the old rule's mis-typed mixed carousel) exports as a carousel", () => {
  assert.equal(exportPostType("reel", 2), "carousel");
  assert.equal(exportPostType("reel", 7), "carousel");
});

test("exportPostType: every other stored value is respected as saved, including manual picks", () => {
  assert.equal(exportPostType("reel", 1), "reel");
  assert.equal(exportPostType("reel", 0), "reel");
  assert.equal(exportPostType("post", 1), "post");
  // a manual "post" on a multi-image post is the user's choice, not a mis-derivation
  assert.equal(exportPostType("post", 3), "post");
  assert.equal(exportPostType("carousel", 2), "carousel");
  assert.equal(exportPostType("carousel", 1), "carousel");
});

console.log(`\n${passed} tests passed`);
