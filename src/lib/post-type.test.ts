// Tests for post-type.ts's pure rules -- no Supabase. Run with:
//   node --experimental-strip-types src/lib/post-type.test.ts

import assert from "node:assert/strict";
import { derivePostType, effectiveCarouselPostIds, effectivePostType } from "./post-type.ts";

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

test("effectivePostType: older mislabelled posts -- a stored 'reel' with 2+ items shows (and exports) as a Carousel", () => {
  assert.equal(effectivePostType("reel", 2), "carousel");
  assert.equal(effectivePostType("reel", 7), "carousel");
});

test("effectivePostType: 2+ items is ALWAYS a Carousel, whatever was stored", () => {
  for (const stored of ["post", "reel", "carousel"] as const) assert.equal(effectivePostType(stored, 3), "carousel");
});

test("effectivePostType: normal single-media posts keep their type -- 1 image Post, 1 video Reel", () => {
  assert.equal(effectivePostType("post", 1), "post");
  assert.equal(effectivePostType("reel", 1), "reel");
  // no media yet: whatever was stored
  assert.equal(effectivePostType("reel", 0), "reel");
  assert.equal(effectivePostType("post", 0), "post");
});

test("effectivePostType agrees with derivePostType for every post whose stored type came from derivation", () => {
  for (const media of [[I], [V], [I, I], [I, V], [V, V], [V, I, I]]) {
    const derived = derivePostType(media)!;
    assert.equal(effectivePostType(derived, media.length), derived, JSON.stringify(media));
  }
});

test("effectiveCarouselPostIds: the library badge counts older 'reel' posts with 2+ items, not single reels", () => {
  const posts = [
    { id: "legacy-mixed", post_type: "reel" as const },
    { id: "single-reel", post_type: "reel" as const },
    { id: "carousel", post_type: "carousel" as const },
    { id: "empty-reel", post_type: "reel" as const },
  ];
  const rows = [{ post_id: "legacy-mixed" }, { post_id: "legacy-mixed" }, { post_id: "single-reel" }, { post_id: "carousel" }, { post_id: "carousel" }];
  assert.deepEqual([...effectiveCarouselPostIds(posts, rows)].sort(), ["carousel", "legacy-mixed"]);
});

console.log(`\n${passed} tests passed`);
