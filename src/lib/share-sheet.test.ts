// Tests for share-sheet.ts. Run with:
//   node --experimental-strip-types src/lib/share-sheet.test.ts

import assert from "node:assert/strict";
// @ts-expect-error -- the Node strip-types runner needs the .ts extension (the other *.test.ts files are excluded in tsconfig instead)
import { saveFilesLabel, shareFiles } from "./share-sheet.ts";

let passed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    throw err;
  }
}

const files = [new File(["a"], "cover.jpg", { type: "image/jpeg" }), new File(["b"], "slide-2.jpg", { type: "image/jpeg" })];

function fakeNav(shareImpl: () => Promise<void>, canShare = true) {
  const calls: File[][] = [];
  return {
    calls,
    nav: {
      canShare: () => canShare,
      share: (data: { files: File[] }) => {
        calls.push(data.files);
        return shareImpl();
      },
    },
  };
}

await test("a successful share is 'shared'", async () => {
  const { nav, calls } = fakeNav(() => Promise.resolve());
  assert.equal(await shareFiles(files, nav), "shared");
  assert.deepEqual(calls, [files]);
});

await test("the user dismissing the sheet is 'shared' (no zip afterwards)", async () => {
  const { nav } = fakeNav(() => Promise.reject(new DOMException("dismissed", "AbortError")));
  assert.equal(await shareFiles(files, nav), "shared");
});

await test("iOS activation timeout (NotAllowedError) is 'needs-tap', not a zip fallback", async () => {
  const { nav } = fakeNav(() => Promise.reject(new DOMException("no gesture", "NotAllowedError")));
  assert.equal(await shareFiles(files, nav), "needs-tap");
});

await test("the retry tap shares the very same File objects (no refetch)", async () => {
  let attempt = 0;
  const { nav, calls } = fakeNav(() =>
    attempt++ === 0 ? Promise.reject(new DOMException("no gesture", "NotAllowedError")) : Promise.resolve(),
  );
  assert.equal(await shareFiles(files, nav), "needs-tap");
  assert.equal(await shareFiles(files, nav), "shared");
  assert.equal(calls[1], files);
});

await test("share() is called synchronously, before any await (keeps the tap's activation)", async () => {
  const { nav, calls } = fakeNav(() => Promise.resolve());
  const pending = shareFiles(files, nav);
  assert.equal(calls.length, 1);
  await pending;
});

await test("other share errors are 'unavailable' (normal zip fallback)", async () => {
  const { nav } = fakeNav(() => Promise.reject(new TypeError("bad data")));
  assert.equal(await shareFiles(files, nav), "unavailable");
});

await test("canShare false, no Web Share, or no files is 'unavailable'", async () => {
  const { nav, calls } = fakeNav(() => Promise.resolve(), false);
  assert.equal(await shareFiles(files, nav), "unavailable");
  assert.equal(calls.length, 0);
  assert.equal(await shareFiles(files, {}), "unavailable");
  assert.equal(await shareFiles(files, undefined), "unavailable");
  assert.equal(await shareFiles([], fakeNav(() => Promise.resolve()).nav), "unavailable");
});

await test("the retry label names images, videos, or both", async () => {
  const img = { type: "image/jpeg" };
  const vid = { type: "video/mp4" };
  assert.equal(saveFilesLabel([img]), "Save 1 Image");
  assert.equal(saveFilesLabel([img, img, img]), "Save 3 Images");
  assert.equal(saveFilesLabel([vid]), "Save 1 Video");
  assert.equal(saveFilesLabel([vid, vid]), "Save 2 Videos");
  assert.equal(saveFilesLabel([vid, img]), "Save 2 Items");
});

console.log(`\n${passed} passed`);
