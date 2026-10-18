// Tests for media-drop.ts. Run with:
//   node --experimental-strip-types src/lib/media-drop.test.ts
//
// Which dropped files are accepted is tested in upload-validation.test.ts.

import assert from "node:assert/strict";
import { isFileDrag } from "./media-drop.ts";

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

test("isFileDrag: only OS file drags count", () => {
  assert.equal(isFileDrag(["Files"]), true);
  assert.equal(isFileDrag(["application/x-moz-file", "Files"]), true);
  assert.equal(isFileDrag(["text/plain", "text/html"]), false, "dragging selected text/link");
  assert.equal(isFileDrag(["text/uri-list"]), false, "dragging an in-page image/link");
  assert.equal(isFileDrag([]), false);
  assert.equal(isFileDrag(null), false);
});

console.log(`\n${passed} passed`);
