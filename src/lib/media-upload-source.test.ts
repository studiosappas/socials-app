// Tests for media-upload-source.ts -- no React, no DOM, no network. Run with:
//   node --experimental-strip-types src/lib/media-upload-source.test.ts
//
// 1. Tab rules and the Grid page's read, incl. the PRE-MIGRATION shape:
//    PostgREST answers a select of a missing column with an error and
//    data: null -- never rows with a null field.
// 2. insertWithUploadSource: retries ONLY on the verified missing-column
//    error, never on anything else -- against a simulated media_assets
//    table that models (a) a not-yet-migrated schema, (b) a commit whose
//    response was lost, and (c) the two RLS policy sets in the repo
//    (schema.sql's base policies and fix_project_role_permission_presets.sql)
//    for the Editor role in particular.
// 3. Undo/Redo source preservation (preferKnownSource + restore's parse).
// 4. Source-text guards over the real files.
//
// NOT covered: the real PostgREST error code/message for a missing column
// (PGRST204 per PostgREST's docs; must be confirmed on Staging before the
// migration) and real RLS -- both are Staging QA.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  countLibraryTabs,
  filterLibraryTab,
  insertWithUploadSource,
  isMissingUploadSourceColumn,
  libraryTabFor,
  parseUploadSource,
  preferKnownSource,
  sourceStateFor,
  uploadSourceFromLookup,
  uploadSourceMap,
  type UploadSource,
  type UploadSourceState,
} from "./media-upload-source.ts";

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    throw err;
  }
}

// ---- Real-shaped errors ----
const MISSING_COLUMN_PGRST = {
  code: "PGRST204",
  message: "Could not find the 'upload_source' column of 'media_assets' in the schema cache",
};
const MISSING_COLUMN_PG = { code: "42703", message: 'column "upload_source" of relation "media_assets" does not exist' };
const RLS_DENIED = { code: "42501", message: 'new row violates row-level security policy for table "media_assets"' };
const NETWORK = { code: "", message: "TypeError: fetch failed" };

// ---------------------------------------------------------------------------
// 1. Tab rules + reads
// ---------------------------------------------------------------------------

await test("only an explicit 'content' is From Content; null / 'unknown' / undefined / 'grid' are Uploaded", () => {
  assert.equal(libraryTabFor("content"), "content");
  for (const s of ["grid", null, "unknown", undefined] as const) assert.equal(libraryTabFor(s), "uploaded");
});

await test("parseUploadSource never turns 'unknown' (or anything else) into a known source", () => {
  assert.equal(parseUploadSource("grid"), "grid");
  assert.equal(parseUploadSource("content"), "content");
  for (const bad of ["unknown", null, undefined, "", "Content", "brief", 1, {}]) assert.equal(parseUploadSource(bad), null);
});

await test("filter + counts partition every item exactly once, keeping order", () => {
  const items: { id: string; uploadSource?: UploadSourceState }[] = [
    { id: "c1", uploadSource: "content" },
    { id: "g1", uploadSource: "grid" },
    { id: "n1", uploadSource: null },
    { id: "u1", uploadSource: "unknown" },
    { id: "x1" },
    { id: "c2", uploadSource: "content" },
  ];
  assert.deepEqual(filterLibraryTab(items, "uploaded").map((i) => i.id), ["g1", "n1", "u1", "x1"]);
  assert.deepEqual(filterLibraryTab(items, "content").map((i) => i.id), ["c1", "c2"]);
  assert.deepEqual(countLibraryTabs(items), { uploaded: 4, content: 2 });
});

await test("migrated read: recorded sources AND recorded nulls are known; missing ids are unknown", () => {
  const map = uploadSourceMap({
    data: [
      { id: "a", upload_source: "grid" },
      { id: "b", upload_source: "content" },
      { id: "c", upload_source: null },
    ],
    error: null,
  });
  assert.equal(sourceStateFor(map, "a"), "grid");
  assert.equal(sourceStateFor(map, "b"), "content");
  assert.equal(sourceStateFor(map, "c"), null);
  // e.g. inserted between the main select and this one -- not "no source".
  assert.equal(sourceStateFor(map, "late"), "unknown");
});

await test("pre-migration read: the select's ERROR makes every asset 'unknown' (shown as Uploaded)", () => {
  for (const error of [MISSING_COLUMN_PG, MISSING_COLUMN_PGRST, NETWORK]) {
    const map = uploadSourceMap({ data: null, error });
    assert.equal(map, null);
    assert.equal(sourceStateFor(map, "a"), "unknown");
  }
  // An error with partial data is still an error.
  assert.equal(uploadSourceMap({ data: [{ id: "a", upload_source: "content" }], error: RLS_DENIED }), null);
});

await test("single-row lookup: error / missing row -> 'unknown'; a recorded null stays null", () => {
  assert.equal(uploadSourceFromLookup({ data: { upload_source: "content" }, error: null }), "content");
  assert.equal(uploadSourceFromLookup({ data: { upload_source: null }, error: null }), null);
  assert.equal(uploadSourceFromLookup({ data: null, error: null }), "unknown");
  assert.equal(uploadSourceFromLookup({ data: null, error: MISSING_COLUMN_PG }), "unknown");
  assert.equal(uploadSourceFromLookup({ data: { upload_source: "content" }, error: NETWORK }), "unknown");
});

// ---------------------------------------------------------------------------
// 2. insertWithUploadSource
// ---------------------------------------------------------------------------

await test("missing-column detection is narrow: right code AND names upload_source", () => {
  assert.equal(isMissingUploadSourceColumn(MISSING_COLUMN_PGRST), true);
  assert.equal(isMissingUploadSourceColumn(MISSING_COLUMN_PG), true);
  for (const e of [
    RLS_DENIED,
    NETWORK,
    { code: "23505", message: "duplicate key value violates unique constraint" },
    { code: "PGRST204", message: "Could not find the 'folder_id' column of 'media_assets' in the schema cache" },
    { code: "42703", message: 'column "thumbnail_storage_path" does not exist' },
    { code: "23514", message: 'new row violates check constraint "media_assets_upload_source_check" (upload_source)' },
    { message: "upload_source" },
    null,
    undefined,
    "PGRST204 upload_source",
  ]) {
    assert.equal(isMissingUploadSourceColumn(e), false, JSON.stringify(e));
  }
});

type Payload = Record<string, unknown>;
function recorder(responses: { error: unknown }[]) {
  const calls: Payload[] = [];
  const run = async (row: Payload) => {
    calls.push(row);
    return responses[calls.length - 1] ?? { error: null };
  };
  return { calls, run };
}

await test("success on the first attempt: one insert, source included", async () => {
  const r = recorder([{ error: null }]);
  await insertWithUploadSource(r.run, { project_id: "p" }, "content");
  assert.deepEqual(r.calls, [{ project_id: "p", upload_source: "content" }]);
});

await test("verified missing column: exactly one retry, WITHOUT the field, and its result is returned", async () => {
  for (const missing of [MISSING_COLUMN_PGRST, MISSING_COLUMN_PG]) {
    const r = recorder([{ error: missing }, { error: null, data: { id: "row-1" } } as { error: unknown }]);
    const result = (await insertWithUploadSource(r.run, { project_id: "p" }, "grid")) as { data?: unknown; error: unknown };
    assert.equal(r.calls.length, 2);
    assert.equal("upload_source" in r.calls[0], true);
    assert.equal("upload_source" in r.calls[1], false);
    assert.deepEqual(result, { error: null, data: { id: "row-1" } });
  }
});

await test("a retry that also fails is returned as-is -- never a third attempt", async () => {
  const r = recorder([{ error: MISSING_COLUMN_PGRST }, { error: RLS_DENIED }]);
  const result = await insertWithUploadSource(r.run, { project_id: "p" }, "grid");
  assert.equal(r.calls.length, 2);
  assert.deepEqual(result.error, RLS_DENIED);
});

await test("every other failure: exactly ONE attempt, error returned unchanged", async () => {
  for (const error of [
    RLS_DENIED,
    NETWORK,
    { code: "23505", message: "duplicate key" },
    { code: "PGRST204", message: "Could not find the 'folder_id' column" },
  ]) {
    const r = recorder([{ error }]);
    const result = await insertWithUploadSource(r.run, { project_id: "p" }, "content");
    assert.equal(r.calls.length, 1, JSON.stringify(error));
    assert.deepEqual(result.error, error);
  }
});

await test("no source to record: one plain insert, the column is never named", async () => {
  const r = recorder([{ error: null }]);
  await insertWithUploadSource(r.run, { project_id: "p" }, null);
  assert.deepEqual(r.calls, [{ project_id: "p" }]);
});

await test("the caller's row object is never mutated", async () => {
  const row = { project_id: "p" };
  await insertWithUploadSource(recorder([{ error: MISSING_COLUMN_PGRST }]).run, row, "grid");
  assert.deepEqual(row, { project_id: "p" });
});

// A simulated media_assets table. RLS mirrors the repo's SQL text exactly:
//   base    -- schema.sql: insert = any member (uploaded_by = auth.uid()),
//              update = owner/admin only;
//   presets -- fix_project_role_permission_presets.sql Sections 1+2:
//              insert AND update = owner/admin/editor.
// An UPDATE that RLS filters out matches zero rows and returns NO error --
// PostgREST's real behaviour, and the reason the old two-step save could
// lose a source silently.
type Role = "owner" | "admin" | "editor" | "viewer" | "client";
type Policy = "base" | "presets";
function fakeMediaAssets(opts: { migrated: boolean; policy: Policy; role: Role; loseResponseOnce?: boolean }) {
  const rows: { id: string; upload_source: UploadSource | null }[] = [];
  let loseResponse = opts.loseResponseOnce ?? false;
  const canInsert = opts.policy === "base" ? true : ["owner", "admin", "editor"].includes(opts.role);
  const canUpdate = ["owner", "admin", ...(opts.policy === "presets" ? ["editor"] : [])].includes(opts.role);
  let attempts = 0;
  return {
    rows,
    get attempts() {
      return attempts;
    },
    async insert(payload: Payload) {
      attempts++;
      if (!opts.migrated && "upload_source" in payload) return { data: null, error: MISSING_COLUMN_PGRST };
      if (!canInsert) return { data: null, error: RLS_DENIED };
      const row = { id: `r${rows.length + 1}`, upload_source: parseUploadSource(payload.upload_source) };
      rows.push(row);
      // Committed, but the response never reached the server action.
      if (loseResponse) {
        loseResponse = false;
        return { data: null, error: NETWORK };
      }
      return { data: { id: row.id }, error: null };
    },
    async update(id: string, patch: { upload_source: UploadSource }) {
      if (!opts.migrated) return { data: null, error: MISSING_COLUMN_PGRST };
      if (!canUpdate) return { data: [], error: null };
      const row = rows.find((r) => r.id === id);
      if (row) row.upload_source = patch.upload_source;
      return { data: row ? [row] : [], error: null };
    },
  };
}

await test("duplicate prevention: pre-migration, N uploads -> exactly N rows (none with a source)", async () => {
  const db = fakeMediaAssets({ migrated: false, policy: "presets", role: "editor" });
  for (let i = 0; i < 25; i++) {
    const result = await insertWithUploadSource((p) => db.insert(p), { project_id: "p" }, i % 2 ? "grid" : "content");
    assert.equal(result.error, null);
  }
  assert.equal(db.rows.length, 25);
  assert.equal(db.attempts, 50); // one rejected-before-write attempt + one real insert each
  assert.ok(db.rows.every((r) => r.upload_source === null));
});

await test("duplicate prevention: migrated, N uploads -> N rows, one attempt each, sources recorded", async () => {
  const db = fakeMediaAssets({ migrated: true, policy: "presets", role: "editor" });
  for (let i = 0; i < 25; i++) await insertWithUploadSource((p) => db.insert(p), { project_id: "p" }, i % 2 ? "grid" : "content");
  assert.equal(db.rows.length, 25);
  assert.equal(db.attempts, 25);
  assert.equal(db.rows.filter((r) => r.upload_source === "content").length, 13);
});

await test("duplicate prevention: a committed insert whose response was lost is NOT retried (1 row, not 2)", async () => {
  const db = fakeMediaAssets({ migrated: true, policy: "presets", role: "owner", loseResponseOnce: true });
  const result = await insertWithUploadSource((p) => db.insert(p), { project_id: "p" }, "content");
  assert.deepEqual(result.error, NETWORK);
  assert.equal(db.attempts, 1);
  assert.equal(db.rows.length, 1);
});

await test("Editor under the BASE policies: source recorded via the insert (the old update would silently lose it)", async () => {
  // New path.
  const db = fakeMediaAssets({ migrated: true, policy: "base", role: "editor" });
  const result = await insertWithUploadSource((p) => db.insert(p), { project_id: "p" }, "content");
  assert.equal(result.error, null);
  assert.equal(db.rows[0].upload_source, "content");

  // The replaced two-step save, for the record: insert, then update --
  // which RLS filters to zero rows with NO error.
  const old = fakeMediaAssets({ migrated: true, policy: "base", role: "editor" });
  const inserted = await old.insert({ project_id: "p" });
  const updated = await old.update((inserted.data as { id: string }).id, { upload_source: "content" });
  assert.equal(updated.error, null);
  assert.deepEqual(updated.data, []);
  assert.equal(old.rows[0].upload_source, null);
});

await test("Editor under the PRESETS policies: source recorded, single attempt", async () => {
  const db = fakeMediaAssets({ migrated: true, policy: "presets", role: "editor" });
  await insertWithUploadSource((p) => db.insert(p), { project_id: "p" }, "grid");
  assert.equal(db.attempts, 1);
  assert.equal(db.rows[0].upload_source, "grid");
});

await test("Client/Viewer denied by the PRESETS insert policy: one attempt, no row, the RLS error surfaces", async () => {
  for (const role of ["client", "viewer"] as const) {
    const db = fakeMediaAssets({ migrated: true, policy: "presets", role });
    const result = await insertWithUploadSource((p) => db.insert(p), { project_id: "p" }, "content");
    assert.deepEqual(result.error, RLS_DENIED);
    assert.equal(db.attempts, 1);
    assert.equal(db.rows.length, 0);
  }
});

await test("Editor before the migration (either policy set): upload succeeds, no source, never an error", async () => {
  for (const policy of ["base", "presets"] as const) {
    const db = fakeMediaAssets({ migrated: false, policy, role: "editor" });
    const result = await insertWithUploadSource((p) => db.insert(p), { project_id: "p" }, "content");
    assert.equal(result.error, null);
    assert.equal(db.rows.length, 1);
    assert.equal(db.rows[0].upload_source, null);
  }
});

// ---------------------------------------------------------------------------
// 3. Undo/Redo source preservation
// ---------------------------------------------------------------------------

// Mirrors use-library-items.ts's command: Undo = deleteMedia (which reads
// the row's source first) then preferKnownSource; Redo = restoreMediaAsset,
// which inserts parseUploadSource(state).
function undoRedo(initial: UploadSourceState, readsAtUndo: UploadSourceState[]) {
  let state = initial;
  const restored: (UploadSource | null)[] = [];
  for (const read of readsAtUndo) {
    state = preferKnownSource(read, state);
    restored.push(parseUploadSource(state));
  }
  return { state, restored };
}

await test("failed page lookup + DB says 'content': Undo/Redo restores 'content'", () => {
  const { state, restored } = undoRedo("unknown", ["content"]);
  assert.equal(state, "content");
  assert.deepEqual(restored, ["content"]);
});

await test("a failed read at Undo never overwrites a known source (repeated cycles)", () => {
  const { state, restored } = undoRedo("content", ["unknown", "unknown", "content", "unknown"]);
  assert.equal(state, "content");
  assert.deepEqual(restored, ["content", "content", "content", "content"]);
  assert.equal(undoRedo("grid", ["unknown"]).state, "grid");
});

await test("unknown everywhere (pre-migration): restored WITHOUT a source and the state stays 'unknown'", () => {
  const { state, restored } = undoRedo("unknown", ["unknown", "unknown"]);
  assert.equal(state, "unknown");
  assert.deepEqual(restored, [null, null]);
});

await test("a recorded null (older row) is known: it replaces 'unknown' and restores as null", () => {
  const { state, restored } = undoRedo("unknown", [null]);
  assert.equal(state, null);
  assert.deepEqual(restored, [null]);
});

await test("preferKnownSource treats undefined (older server response) as no information", () => {
  assert.equal(preferKnownSource(undefined, "content"), "content");
});

// ---------------------------------------------------------------------------
// 4. Source-text guards over the real files
// ---------------------------------------------------------------------------

const root = new URL("../../", import.meta.url);
// Line endings normalized -- the working tree is CRLF on Windows.
const read = (p: string) => fs.readFileSync(new URL(p, root), "utf8").replace(/\r\n/g, "\n");
const withoutComments = (s: string) => s.replace(/^\s*\/\/.*$/gm, "");

function functionBody(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  const next = src.indexOf("\nexport ", start + 1);
  return src.slice(start, next === -1 ? undefined : next);
}

function allSourceFiles(dir: string): string[] {
  return (fs.readdirSync(dir, { recursive: true }) as string[])
    .filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith(".test.ts"))
    .map((f) => path.join(dir, f));
}
const srcDir = new URL("src/", root);
const srcFiles = allSourceFiles(srcDir.pathname.replace(/^\/([A-Za-z]:)/, "$1"));

const grid = read("src/lib/actions/grid.ts");
const posts = read("src/lib/actions/posts.ts");
const stories = read("src/lib/actions/stories.ts");
const media = read("src/lib/actions/media.ts");

await test("every upload, restore and clone path inserts through insertMediaAsset with the right source", () => {
  const cases: [string, string, string][] = [
    [grid, "uploadMedia", '"grid"'],
    [posts, "uploadPostAsset", '"grid"'],
    [posts, "replacePostAsset", '"grid"'],
    [stories, "uploadContentAsset", '"content"'],
    [stories, "uploadStoryFrame", '"content"'],
    [grid, "restoreMediaAsset", "parseUploadSource(data.uploadSource)"],
    [media, "cloneMediaAssetForDivergence", 'origin === "unknown" ? null : origin'],
  ];
  for (const [src, name, expected] of cases) {
    const m = functionBody(src, name).match(/insertMediaAsset\(\s*supabase,\s*\{[\s\S]*?\n\s*\},\s*([^\n]+?),?\s*\n\s*\)/);
    assert.ok(m, `${name}: no insertMediaAsset(supabase, {...}, source) call`);
    assert.equal(m[1].trim(), expected, name);
  }
});

await test("the only raw media_assets inserts left: insertMediaAsset itself and Brief's generated design", () => {
  const hits: string[] = [];
  for (const file of srcFiles) {
    const text = fs.readFileSync(file, "utf8");
    const n = [...text.matchAll(/from\("media_assets"\)\s*\.insert\(/g)].length;
    for (let i = 0; i < n; i++) hits.push(path.basename(file));
  }
  assert.deepEqual(hits.sort(), ["brief.ts", "media.ts"]);
  assert.ok(functionBody(media, "insertMediaAsset").includes('from("media_assets").insert(payload)'));
});

await test("no follow-up source UPDATE remains anywhere", () => {
  for (const file of srcFiles) {
    const text = fs.readFileSync(file, "utf8");
    assert.equal(text.includes("setMediaAssetUploadSource"), false, file);
    assert.equal(/update\(\{[^}]*upload_source/.test(text), false, file);
  }
});

await test("Grid page: upload_source read is isolated, filtered by project_id (no id list), mapped to states", () => {
  const page = read("src/app/projects/[projectId]/grid/page.tsx");
  const m = page.match(/\.select\("id, upload_source"\)([\s\S]*?),\n/);
  assert.ok(m, "isolated select missing");
  assert.ok(m[1].includes('.eq("project_id", projectId)'));
  assert.equal(m[1].includes(".in("), false);
  assert.equal(
    [...withoutComments(page).matchAll(/upload_source/g)].length,
    1,
    "upload_source must appear only in that one select",
  );
  assert.ok(page.includes("uploadSourceMap(uploadSourceResult)"));
  assert.ok(page.includes("sourceStateFor(uploadSourceByAssetId, asset.id)"));
});

await test("deleteMedia reads the source before deleting (in parallel) and returns it", () => {
  const body = functionBody(grid, "deleteMedia");
  const read = body.indexOf("readMediaAssetUploadSource(supabase, mediaAssetId)");
  assert.ok(read > 0 && read < body.indexOf('.from("media_assets").delete()'));
  assert.ok(body.includes("return { uploadSource };"));
});

await test("both Library Undo paths keep the DB's source and never default a failed lookup to null", () => {
  const hook = read("src/app/projects/[projectId]/grid/use-library-items.ts");
  assert.equal([...hook.matchAll(/preferKnownSource\(removed\?\.uploadSource, (currentRef|current)\.uploadSource\)/g)].length, 2);
  assert.ok(hook.includes('uploadSource: item.uploadSource ?? "unknown"'));
  assert.equal(hook.includes("item.uploadSource ?? null"), false);
});

await test("the migration: additive, nullable, re-runnable, valid DO block, reloads the schema cache", () => {
  const sql = read("supabase/add_media_upload_source.sql");
  const code = sql.replace(/^--.*$/gm, "");
  assert.ok(code.includes("add column if not exists upload_source text null"));
  assert.ok(code.includes("check (upload_source in ('grid', 'content'))"));
  assert.ok(/do \$\$[\s\S]*end \$\$;/.test(code), "DO block must open and close with $$");
  assert.ok(code.trim().endsWith("notify pgrst, 'reload schema';"));
  assert.equal(/\bupdate\s+public\./i.test(code), false, "no backfill");
  assert.equal(/\bdefault\b/i.test(code), false, "no default");
});

console.log(`\n${passed} passed`);
