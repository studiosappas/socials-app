// Tests for media-drop.ts. Run with:
//   node --experimental-strip-types src/lib/media-drop.test.ts

import assert from "node:assert/strict";
import { isAcceptedMediaFile, isFileDrag, partitionDroppedFiles, rejectedFilesMessage } from "./media-drop.ts";

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

test("isAcceptedMediaFile: matches the picker's image/*,video/* accept list", () => {
  for (const type of ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "video/mp4", "video/quicktime", "video/webm"]) {
    assert.equal(isAcceptedMediaFile({ name: "x", type }), true, type);
  }
  for (const type of ["application/pdf", "text/plain", "application/zip", "audio/mpeg"]) {
    assert.equal(isAcceptedMediaFile({ name: "x", type }), false, type);
  }
});

test("isAcceptedMediaFile: empty-MIME HEIC/HEIF accepted by extension, other empty-MIME files rejected", () => {
  assert.equal(isAcceptedMediaFile({ name: "IMG_0001.HEIC", type: "" }), true);
  assert.equal(isAcceptedMediaFile({ name: "photo.heif", type: "" }), true);
  assert.equal(isAcceptedMediaFile({ name: "clip.mov", type: "" }), false, "never guess a video as an image");
  assert.equal(isAcceptedMediaFile({ name: "README", type: "" }), false);
});

test("partitionDroppedFiles: keeps drop order within each group (multi-file drop)", () => {
  const files = [
    { name: "a.jpg", type: "image/jpeg" },
    { name: "notes.pdf", type: "application/pdf" },
    { name: "b.mp4", type: "video/mp4" },
    { name: "c.png", type: "image/png" },
  ];
  const { accepted, rejected } = partitionDroppedFiles(files);
  assert.deepEqual(accepted.map((f) => f.name), ["a.jpg", "b.mp4", "c.png"]);
  assert.deepEqual(rejected.map((f) => f.name), ["notes.pdf"]);
});

test("rejectedFilesMessage", () => {
  assert.equal(rejectedFilesMessage([]), null);
  assert.match(rejectedFilesMessage([{ name: "notes.pdf" }])!, /notes\.pdf/);
  assert.match(rejectedFilesMessage([{ name: "a" }, { name: "b" }])!, /^2 files/);
});

console.log(`\n${passed} passed`);
