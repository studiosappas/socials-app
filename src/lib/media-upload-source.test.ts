// Tests for media-upload-source.ts -- no React, no DOM, no network. Run with:
//   node --experimental-strip-types src/lib/media-upload-source.test.ts
//
// Two halves:
// 1. The tab rules themselves (NULL -> Uploaded, counts, filtering) and the
//    Grid page's read of upload_source, including the PRE-MIGRATION shape:
//    PostgREST answers a select of a missing column with an error and
//    data: null -- never rows with a null field.
// 2. Source-text guards over the real action files: each upload path
//    records the right source through its own follow-up update, and no
//    media_assets insert/main select ever names upload_source (which would
//    break every upload / empty the whole Library before the migration).
//
// What this does NOT cover: the real database round trip (the update
// actually landing post-migration, RLS) -- that is Staging QA.

import assert from "node:assert/strict";
import fs from "node:fs";
import {
  countLibraryTabs,
  filterLibraryTab,
  libraryTabFor,
  parseUploadSource,
  uploadSourceMap,
} from "./media-upload-source.ts";

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

test("only an explicit 'content' is From Content; null/undefined/'grid' are Uploaded", () => {
  assert.equal(libraryTabFor("content"), "content");
  assert.equal(libraryTabFor("grid"), "uploaded");
  assert.equal(libraryTabFor(null), "uploaded");
  assert.equal(libraryTabFor(undefined), "uploaded");
});

test("parseUploadSource rejects anything but the two known values", () => {
  assert.equal(parseUploadSource("grid"), "grid");
  assert.equal(parseUploadSource("content"), "content");
  for (const bad of [null, undefined, "", "Content", "brief", 1, {}]) assert.equal(parseUploadSource(bad), null);
});

test("filter + counts partition every item exactly once", () => {
  const items = [
    { id: "a", uploadSource: "grid" as const },
    { id: "b", uploadSource: "content" as const },
    { id: "c", uploadSource: null },
    { id: "d" },
    { id: "e", uploadSource: "content" as const },
  ];
  assert.deepEqual(
    filterLibraryTab(items, "uploaded").map((i) => i.id),
    ["a", "c", "d"],
  );
  assert.deepEqual(
    filterLibraryTab(items, "content").map((i) => i.id),
    ["b", "e"],
  );
  assert.deepEqual(countLibraryTabs(items), { uploaded: 3, content: 2 });
  assert.deepEqual(countLibraryTabs([]), { uploaded: 0, content: 0 });
});

test("filtering keeps the server's order (created_at DESC) within a tab", () => {
  const items = ["c1", "g1", "c2", "g2", "c3"].map((id) => ({ id, uploadSource: id[0] === "c" ? ("content" as const) : null }));
  assert.deepEqual(
    filterLibraryTab(items, "content").map((i) => i.id),
    ["c1", "c2", "c3"],
  );
});

test("migrated database: rows map to their sources, null rows are omitted", () => {
  const map = uploadSourceMap({
    data: [
      { id: "a", upload_source: "grid" },
      { id: "b", upload_source: "content" },
      { id: "c", upload_source: null },
    ],
    error: null,
  });
  assert.equal(map.get("a"), "grid");
  assert.equal(map.get("b"), "content");
  assert.equal(map.has("c"), false);
});

test("pre-migration database: the select's ERROR means no sources -> all Uploaded", () => {
  // The real PostgREST shape for a missing column.
  const result = {
    data: null,
    error: { code: "42703", message: "column media_assets.upload_source does not exist" },
  };
  const map = uploadSourceMap(result);
  assert.equal(map.size, 0);
  const items = ["a", "b"].map((id) => ({ id, uploadSource: map.get(id) ?? null }));
  assert.deepEqual(countLibraryTabs(items), { uploaded: 2, content: 0 });
});

test("an error with partial data is still treated as no sources", () => {
  assert.equal(uploadSourceMap({ data: [{ id: "a", upload_source: "content" }], error: { message: "x" } }).size, 0);
});

test("malformed rows / unexpected values are ignored, never thrown on", () => {
  const map = uploadSourceMap({
    data: [null, 7, { id: 5, upload_source: "content" }, { id: "x", upload_source: "other" }, { id: "y" }, { id: "z", upload_source: "content" }],
    error: null,
  });
  assert.deepEqual([...map.entries()], [["z", "content"]]);
  assert.equal(uploadSourceMap({ data: undefined, error: null }).size, 0);
});

// ---- Source-text guards over the real action/page files ----

const read = (p: string) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

// The body of `export async function <name>(` up to the next top-level
// `export ` -- enough to scope a check to one action.
function functionBody(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  const next = src.indexOf("\nexport ", start + 1);
  return src.slice(start, next === -1 ? undefined : next);
}

const grid = read("src/lib/actions/grid.ts");
const posts = read("src/lib/actions/posts.ts");
const stories = read("src/lib/actions/stories.ts");
const media = read("src/lib/actions/media.ts");
const brief = read("src/lib/actions/brief.ts");

test("every upload path records its source via the isolated follow-up update", () => {
  const cases: [string, string, string][] = [
    [grid, "uploadMedia", `setMediaAssetUploadSource(supabase, mediaAsset.id, "grid")`],
    [posts, "uploadPostAsset", `setMediaAssetUploadSource(supabase, mediaAsset.id, "grid")`],
    [posts, "replacePostAsset", `setMediaAssetUploadSource(supabase, mediaAsset.id, "grid")`],
    [stories, "uploadContentAsset", `setMediaAssetUploadSource(supabase, mediaAsset.id, "content")`],
    [stories, "uploadStoryFrame", `setMediaAssetUploadSource(supabase, mediaAsset.id, "content")`],
    [grid, "restoreMediaAsset", "setMediaAssetUploadSource(supabase, mediaAsset.id, data.uploadSource ?? null)"],
    [media, "cloneMediaAssetForDivergence", "setMediaAssetUploadSource(supabase, clone.id, parseUploadSource("],
  ];
  for (const [src, name, call] of cases) assert.ok(functionBody(src, name).includes(call), `${name} missing: ${call}`);
});

test("the Content upload paths still read the frame insert's error from the right slot", () => {
  // setMediaAssetUploadSource was added as a middle Promise.all element; the
  // destructure must skip both it and the poster call.
  for (const name of ["uploadContentAsset", "uploadStoryFrame"]) {
    const body = functionBody(stories, name);
    assert.ok(body.includes("const [, , { error: frameError }] = await Promise.all(["), name);
  }
});

test("Brief's generated designs stay unstamped (NULL -> Uploaded)", () => {
  assert.equal(brief.includes("upload_source"), false);
  assert.equal(brief.includes("setMediaAssetUploadSource"), false);
});

test("no media_assets INSERT anywhere names upload_source", () => {
  const files = [grid, posts, stories, media, brief];
  let inserts = 0;
  for (const src of files) {
    for (const m of src.matchAll(/from\("media_assets"\)\s*\.insert\(\{([\s\S]*?)\}\)/g)) {
      inserts++;
      assert.equal(m[1].includes("upload_source"), false, `insert names upload_source: ${m[1].slice(0, 80)}`);
    }
  }
  // Not vacuous: all 8 known insert sites were actually inspected.
  assert.equal(inserts, 8);
});

test("the Grid page reads upload_source only in its own isolated select", () => {
  const page = read("src/app/projects/[projectId]/grid/page.tsx");
  const selects = [...page.matchAll(/\.select\("([^"]*)"\)/g)].map((m) => m[1]);
  const withSource = selects.filter((s) => s.includes("upload_source"));
  assert.deepEqual(withSource, ["id, upload_source"]);
  assert.ok(page.includes("uploadSourceMap(uploadSourceResult)"), "page must keep the whole result (incl. error)");
});

test("the migration is additive, nullable and re-runnable", () => {
  const sql = read("supabase/add_media_upload_source.sql");
  assert.ok(sql.includes("add column if not exists upload_source text null"));
  assert.ok(sql.includes("check (upload_source in ('grid', 'content'))"));
  assert.equal(/\bupdate\s+public\./i.test(sql), false, "no backfill");
  assert.equal(/\bdefault\b/i.test(sql.replace(/^--.*$/gm, "")), false, "no default");
});

console.log(`\n${passed} passed`);
