// Structural regression tests for Grid Paste Style's shared-media isolation
// (grid-board.tsx) -- reads the source, no React/DOM/Supabase. Run with:
//   node --experimental-strip-types "src/app/projects/[projectId]/grid/paste-style-isolation.test.ts"
//
// Paste Style used to save with no postId, so the server never isolated a
// shared cover: the pasted text/adjustments (and the crop reset) landed on
// every other post using the same media asset, and Undo/Redo did the same.
// The server half lives in lib/post-usage-isolation.ts (its own tests);
// these pin the client half -- every save passes the post, every save and
// tile update uses the CURRENT asset id, and a failed Undo/Redo save never
// touches the tile or the crop.

import assert from "node:assert/strict";
import fs from "node:fs";

const src = fs.readFileSync(new URL("./grid-board.tsx", import.meta.url), "utf8");

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

// The text of a `const name = useCallback(` block, up to its deps array.
function callbackBody(name: string): string {
  const start = src.indexOf(`const ${name} = useCallback(`);
  assert.ok(start >= 0, `${name} not found`);
  const end = src.indexOf("\n  }, [", start);
  assert.ok(end > start, `${name}: end of callback not found`);
  return src.slice(start, end);
}

// Every `fn(...)` call in `text`, as its full argument text (balanced parens).
function calls(text: string, fn: string): { at: number; args: string }[] {
  const out: { at: number; args: string }[] = [];
  const re = new RegExp(`\\b${fn}\\(`, "g");
  for (let m = re.exec(text); m; m = re.exec(text)) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < text.length && depth > 0; i++) {
      if (text[i] === "(") depth++;
      else if (text[i] === ")") depth--;
    }
    out.push({ at: m.index, args: text.slice(m.index + m[0].length, i - 1) });
  }
  return out;
}

const paste = callbackBody("handlePasteStyle");
const persist = callbackBody("persistAnnotationState");
const undoStart = paste.indexOf("undo: async () => {");
const redoStart = paste.indexOf("redo: async () => {");

test("every exportAndSaveAnnotation call in grid-board.tsx passes postId", () => {
  const all = calls(src, "exportAndSaveAnnotation").filter((c) => c.args.includes("canvas"));
  assert.equal(all.length, 2, "expected the paste save + persistAnnotationState's save");
  for (const c of all) assert.match(c.args, /\bpostId\b/, `save without postId: ${c.args.trim().slice(0, 80)}`);
});

test("persistAnnotationState takes a postId and forwards it to the save", () => {
  assert.match(persist, /\bpostId: string,/);
  const [save] = calls(persist, "exportAndSaveAnnotation");
  assert.match(save.args, /\bpostId,/);
});

test("the paste save targets owned.assetId, never the id captured at setup", () => {
  const [save] = calls(paste, "exportAndSaveAnnotation");
  assert.match(save.args, /attachmentId: owned\.assetId/);
  assert.doesNotMatch(paste, /attachmentId: mediaAssetId/);
});

test("Undo and Redo save onto owned.assetId with this post's id", () => {
  const persists = calls(paste, "persistAnnotationState");
  assert.equal(persists.length, 2, "expected one Undo and one Redo save");
  for (const c of persists) {
    const args = c.args.split(",").map((a) => a.trim());
    assert.equal(args[2], "owned.assetId", `asset arg was ${args[2]}`);
    assert.equal(args[3], "postId", `post arg was ${args[3]}`);
  }
});

test("every save result is followed (paste, Undo, Redo) before the tile is updated", () => {
  assert.match(paste, /const owned = \{ assetId: mediaAssetId \}/);
  const follows = [...paste.matchAll(/followSavedAsset\((result|beforeResult|afterResult)\)/g)].map((m) => m[1]);
  assert.deepEqual(follows, ["result", "beforeResult", "afterResult"]);
});

test("every tile update in the asset paste sets coverMediaAssetId in both the optimistic value and the commit patch", () => {
  const assetPaste = paste.slice(paste.indexOf("if (wantsAssetPaste && slot.coverMediaAssetId"));
  const updates = calls(assetPaste, "mutateSlot");
  assert.equal(updates.length, 3, "expected the paste reconcile + Undo + Redo tile updates");
  for (const u of updates) {
    const n = (u.args.match(/coverMediaAssetId: /g) ?? []).length;
    assert.equal(n, 2, `tile update sets coverMediaAssetId ${n}x: ${u.args.trim().slice(0, 80)}`);
    assert.doesNotMatch(u.args, /coverMediaAssetId: mediaAssetId/);
  }
});

test("a failed Undo/Redo save throws before any crop write or tile update", () => {
  for (const [label, start, end] of [
    ["undo", undoStart, redoStart],
    ["redo", redoStart, paste.indexOf("});", redoStart)],
  ] as const) {
    assert.ok(start > 0 && end > start, `${label} block not found`);
    const block = paste.slice(start, end);
    const throwAt = block.search(/if \(!\("previewUrl" in \w+\)\) throw new Error/);
    assert.ok(throwAt > 0, `${label}: no throw on a failed save`);
    assert.ok(throwAt < block.indexOf("persistCropOnly("), `${label}: crop written before the failure check`);
    assert.ok(throwAt < block.indexOf("mutateSlot("), `${label}: tile updated before the failure check`);
    // The old fallback showed a stale preview as if the undo/redo worked.
    assert.doesNotMatch(block, /: targetSlot\.thumbnailUrl;|: result\.previewUrl;/);
  }
});

test("crop writes in the asset paste use this post's id, not a non-null assertion on the captured slot", () => {
  assert.doesNotMatch(paste, /persistCropOnly\(targetSlot\.postId!/);
});

console.log(`\n${passed} tests passed`);
