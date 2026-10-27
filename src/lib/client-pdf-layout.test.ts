// Tests for client-pdf-layout.ts. Run with:
//   node --experimental-strip-types src/lib/client-pdf-layout.test.ts
// The rendered half (each thumb = that item's whole saved frame at the post's
// ratio) is scripts/reel-cover-crop.check.mjs part E.

import assert from "node:assert/strict";
import { clientPdfThumbSize } from "./client-pdf-layout.ts";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

// the Client PDF's real values (grid/export-pdf/route.ts)
const CONTENT_W = 612 - 40 * 2;
const GAP = 4;
const IDEAL_H = 90 / (3 / 4);
const size = (count: number, aspect: number) => clientPdfThumbSize(count, aspect, CONTENT_W, GAP, IDEAL_H);
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

test("legacy (3:4) posts keep exactly the old 90 x 120 thumbs, and the old carousel shrink", () => {
  assert.deepEqual(size(1, 3 / 4), { w: 90, h: 120 });
  assert.deepEqual(size(5, 3 / 4), { w: 90, h: 120 });
  const ten = size(10, 3 / 4);
  assert.ok(near(ten.w, (CONTENT_W - 9 * GAP) / 10) && near(ten.h, ten.w / 0.75));
});

test("a post with a ratio: the same 120 pt height at its own ratio", () => {
  for (const a of [16 / 9, 4 / 5, 1, 5 / 4, 9 / 16, 1.6]) {
    const t = size(1, a);
    assert.ok(near(t.h, 120) && near(t.w / t.h, a), `${a}: ${t.w}x${t.h}`);
  }
  assert.ok(near(size(1, 16 / 9).w, 120 * 16 / 9));
});

test("a row that wouldn't fit shrinks uniformly, keeping the ratio -- never wider than the content", () => {
  for (const [count, a] of [[3, 16 / 9], [10, 16 / 9], [10, 4 / 5], [20, 1]] as const) {
    const t = size(count, a);
    assert.ok(count * t.w + (count - 1) * GAP <= CONTENT_W + 1e-9, `${count} x ${a}`);
    assert.ok(near(t.w / t.h, a) && t.h <= 120 + 1e-9);
  }
  // a single extremely wide Original never exceeds the content width
  const wide = size(1, 6);
  assert.ok(wide.w <= CONTENT_W + 1e-9 && near(wide.w / wide.h, 6));
});

console.log(`\n${passed} tests passed`);
