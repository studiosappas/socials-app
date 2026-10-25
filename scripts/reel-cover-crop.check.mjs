// Opt-in REAL-BROWSER + MEASURED check for a standalone Reel's cover crop:
// one 9:16 framing, exported as the Reel's 1080x1920 cover image, shown in
// every 3:4 surface as its fixed, centred 3:4 Grid band (lib/cover-framing.ts).
// Not part of the default test run: it starts a Next dev server and needs
// Playwright's Chromium and WebKit.
//
//   node scripts/reel-cover-crop.check.mjs
//
//  A. EXPORT, measured. A TEMPORARY route runs the REAL planPostExport +
//     renderPostExport (the Download Media zip / per-frame cover image) and
//     the REAL applyCoverTransform at a 3:4 cell (the PDF / Full Feed PNG
//     path) over covers whose pixels encode their own position (R = x,
//     G = y). Expected pixels come from an INDEPENDENT model of the on-screen
//     CSS framing, never from the renderer itself. Portrait (edited and
//     automatic), landscape and square automatic posters.
//  B. POST EDITOR, real browser: the REAL Modal + PostEditor. Crop on a
//     standalone Reel opens a 9:16 frame with the centred 3:4 Grid band;
//     Apply writes a reel-cover crop and refreshes; the cover tile is the
//     band (pixels vs the model AND vs the server's own band render); the
//     crop survives a remount; older 3:4 Reel covers and carousel videos
//     keep their 3:4 crop; Save Cover Image is route-rendered.
//  C. EDIT COVER, real browser (Chromium -- WebKit can't decode the WebM
//     fixture): saving keeps or resets the crop as the server says, with a
//     notice on reset; reopening Edit Cover after a save restores the saved
//     edit instead of the frame picker.
//  D. GRID, real browser: the REAL GridBoard (demoMode -- crops apply to the
//     tile without a backend). A Reel's Crop opens the same 9:16 editor and
//     its tile shows the band; a carousel video still crops in place at 3:4.
//
// Everything temporary lives under one proxy-public folder that is ALWAYS
// deleted again. Not covered: the real routes' Supabase reads and the server
// action's own keep/reset decision (sameBaseFraming is unit-tested in
// annotation-frame.test.ts) -- no database here. Playwright's WebKit is not
// Safari.

import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import JSZip from "jszip";
import sharp from "sharp";
import { chromium, webkit } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HARNESS_DIR = path.join(ROOT, "src", "app", "preview-reel-cover-crop-harness-check");
const PORT = 3129;
const BASE = `http://localhost:${PORT}/preview-reel-cover-crop-harness-check`;
const M = "https://media.test/";

const POSTERS = {
  "reel-edited.jpg": [1080, 1920], // as Edit Cover saves a Reel cover
  "auto-portrait.jpg": [720, 1280], // automatic poster, portrait video
  "auto-landscape.jpg": [1280, 720], // automatic poster, landscape video
  "auto-square.jpg": [1000, 1000], // automatic poster, square video
  "auto-45.jpg": [1080, 1350], // automatic poster, 4:5 (feed-style) video
  "img-768x480.jpg": [768, 480], // a landscape photo
  "legacy-34.jpg": [1080, 1440], // an older 3:4 Reel cover
};

// ---------------------------------------------------------------------------
// temporary route: real export code over self-describing fixtures
// ---------------------------------------------------------------------------
const ROUTE = `// TEMPORARY -- created and deleted by scripts/reel-cover-crop.check.mjs. Never commit.
import sharp from "sharp";
import JSZip from "jszip";
import { planPostExport, withAspectFrames, type PostExportAsset } from "@/lib/post-export-plan";
import { aspectValue, parseAspectChoice } from "@/lib/aspect-ratio";
import { renderPostExport } from "@/lib/post-export";
import { applyCoverTransform } from "@/lib/image-crop";
import { exportCoverFraming } from "@/lib/cover-framing";

const POSTERS: Record<string, [number, number]> = ${JSON.stringify(POSTERS)};
// R = column, G = row (0..255 across the image), B constant: a pixel says where it came from.
async function encoded(w: number, h: number) {
  const raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 3;
    raw[o] = Math.round((255 * x) / (w - 1));
    raw[o + 1] = Math.round((255 * y) / (h - 1));
    raw[o + 2] = 90;
  }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 97 }).toBuffer();
}
let cache: Promise<Map<string, Buffer>> | null = null;
function fixtures() {
  cache ??= (async () => {
    const m = new Map<string, Buffer>();
    for (const [name, [w, h]] of Object.entries(POSTERS)) m.set("p/" + name, await encoded(w, h));
    const video = Buffer.alloc(50000);
    for (let i = 0; i < video.length; i++) video[i] = (i * 17 + 3) % 251;
    m.set("p/reel.mp4", video);
    m.set("p/slide.png", await sharp({ create: { width: 1080, height: 1350, channels: 3, background: "#336699" } }).png().toBuffer());
    return m;
  })();
  return cache;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const files = await fixtures();
  const fixture = url.searchParams.get("fixture");
  if (fixture) {
    const buf = files.get(fixture);
    return buf ? new Response(new Uint8Array(buf)) : new Response("no such fixture", { status: 404 });
  }
  const t = url.searchParams.get("t") ? JSON.parse(url.searchParams.get("t")!) : null;
  const poster = "p/" + (url.searchParams.get("poster") ?? "reel-edited.jpg");
  // the PDF / Full Feed PNG path: a 3:4 cell
  if (url.searchParams.get("cell")) {
    const pipeline = await applyCoverTransform(files.get(poster)!, t, 360, 480);
    return new Response(new Uint8Array(await pipeline.png().toBuffer()), { headers: { "content-type": "image/png" } });
  }
  const V: PostExportAsset = { postAssetId: "pa-v", mediaType: "video", storagePath: "p/reel.mp4", previewPath: null, posterPath: poster, coverEdited: true };
  const I: PostExportAsset = { postAssetId: "pa-i", mediaType: "image", storagePath: "p/slide.png", previewPath: null };
  const P = (id: string, name: string): PostExportAsset => ({ postAssetId: id, mediaType: "image", storagePath: "p/" + name, previewPath: null });
  const layout = url.searchParams.get("assets");
  const assets =
    layout === "carousel" ? [V, I]
    : layout === "post" ? [P("pa-i", url.searchParams.get("poster") ?? "img-768x480.jpg")]
    : layout === "carousel3" ? [P("pa-1", "auto-landscape.jpg"), V, P("pa-3", "auto-square.jpg")]
    : [V];
  // exactly what posts/[postId]/export/route.ts does with the stored crop
  const coverIsReel = assets.length === 1 && assets[0].mediaType === "video";
  // ...and with a chosen aspect ratio + per-item frames
  const choice = parseAspectChoice(url.searchParams.get("aspect"));
  const frames = new Map(Object.entries(JSON.parse(url.searchParams.get("frames") ?? "{}")) as [string, { scale: number; x: number; y: number }][]);
  let aspect: number | null = null;
  if (choice === "original") {
    const first = assets[0];
    const meta = await sharp(files.get(first.mediaType === "video" ? first.posterPath! : first.storagePath)!).metadata();
    aspect = meta.width! / meta.height!;
  } else if (choice) aspect = aspectValue(choice, null);
  const coverTransform = aspect ? null : exportCoverFraming(t, coverIsReel);
  let plan = aspect ? withAspectFrames(planPostExport(assets, null, "edited"), assets, aspect, frames) : planPostExport(assets, coverTransform, "edited");
  const only = url.searchParams.get("asset");
  if (only) plan = plan.filter((i) => i.postAssetId === only && i.part === (url.searchParams.get("part") ?? "media"));
  const rendered = await renderPostExport(plan, coverTransform, async (p) => files.get(p) ?? null, { reelCover: coverIsReel && !aspect });
  if (only) return new Response(new Uint8Array(rendered[0].data), { headers: { "X-Filename": rendered[0].item.filename } });
  const zip = new JSZip();
  for (const { item, data } of rendered) zip.file(item.filename, data);
  return new Response(new Uint8Array(await zip.generateAsync({ type: "nodebuffer" })), { headers: { "content-type": "application/zip" } });
}
`;

// ---------------------------------------------------------------------------
// temporary pages: the REAL Post Editor, the REAL Grid
// ---------------------------------------------------------------------------
const UI = `"use client";
// TEMPORARY -- created and deleted by scripts/reel-cover-crop.check.mjs. Never commit.
import { useEffect, useMemo, useState } from "react";
import { Modal } from "../../projects/[projectId]/modal";
import { PostEditor, type PostAssetItem } from "../../projects/[projectId]/posts/[postId]/post-editor";
declare global { interface Window { __cfg?: { t: unknown; kind: string; poster: string; annotation: object | null; aspect?: string | null; frame?: object | null } } }
const M = "${M}";
const LIBRARY = Promise.resolve({ entries: [], nextCursor: null, hasMore: false });
export default function Harness() {
  const [cfg, setCfg] = useState<Window["__cfg"] | null>(null);
  useEffect(() => setCfg(window.__cfg ?? { t: null, kind: "reel", poster: "reel-edited.jpg", annotation: null }), []);
  // Stable across re-renders, like real server data: the editor refreshes after
  // a save, and a fresh object carrying the ORIGINAL values would reset it.
  const data = useMemo(() => (cfg ? build(cfg) : null), [cfg]);
  if (!data) return null;
  return (
    <Modal onClose={() => {}}>
      <PostEditor projectId="00000000-0000-0000-0000-000000000000" post={data.post as never}
        assets={data.assets} links={[]} mediaLibraryPromise={LIBRARY} canManage role="owner"
        currentUserId="00000000-0000-0000-0000-000000000002" members={[]} dateFormat="DD/MM/YYYY" hideBackLink enableMediaViewer />
    </Modal>
  );
}
function build(cfg: NonNullable<Window["__cfg"]>) {
  const video = { postAssetId: "pa-v", mediaAssetId: "m-v", url: M + "reel.webm", originalUrl: M + "reel.webm", annotationJson: cfg.annotation,
    mediaType: "video", posterUrl: M + cfg.poster, coverEdited: true, frameTransform: cfg.frame ?? null } as PostAssetItem;
  const image = { postAssetId: "pa-i", mediaAssetId: "m-i", url: M + "slide.png", originalUrl: M + "slide.png", annotationJson: null, mediaType: "image", posterUrl: null } as PostAssetItem;
  const img = (id: string, name: string) => ({ postAssetId: id, mediaAssetId: "m-" + id, url: M + name, originalUrl: M + name, annotationJson: null, mediaType: "image", posterUrl: null }) as PostAssetItem;
  const assets =
    cfg.kind === "carousel" ? [video, image]
    : cfg.kind === "post" ? [img("pa-i", cfg.poster)]
    : cfg.kind === "carousel3" ? [img("pa-1", "auto-landscape.jpg"), video, img("pa-3", "auto-square.jpg")]
    : [video];
  const post = { id: "00000000-0000-0000-0000-000000000001", post_type: cfg.kind.startsWith("carousel") ? "carousel" : cfg.kind === "post" ? "post" : "reel", caption: "", notes: "", scheduled_date: null, scheduled_time: null, status: "draft", review_status: "pending", coverTransform: cfg.t, aspectRatio: cfg.aspect ?? null };
  return { post, assets };
}
`;
const GRID = `"use client";
// TEMPORARY -- created and deleted by scripts/reel-cover-crop.check.mjs. Never commit.
import { useEffect, useState } from "react";
import { GridBoard, type GridBoardRow } from "../../projects/[projectId]/grid/grid-board";
const M = "${M}";
const slot = (id: string, o: object) => ({ id: "s-" + id, postId: "post-" + id, thumbnailUrl: null, coverMediaType: null, coverMediaAssetId: "m-" + id,
  coverOriginalUrl: M + "reel.webm", assetCount: 1, coverTransform: null, scheduledDate: null, coverPostAssetId: "pa-" + id, aspectRatio: null, coverFrameTransform: null, ...o });
const ROWS = [{ id: "r1", slots: [
  slot("reel", { thumbnailUrl: M + "reel-edited.jpg", coverMediaType: "video", assetCount: 1 }),
  slot("carousel", { thumbnailUrl: M + "auto-portrait.jpg", coverMediaType: "video", assetCount: 3 }),
  slot("legacy", { thumbnailUrl: M + "legacy-34.jpg", coverMediaType: "video", assetCount: 1 }),
] }] as GridBoardRow[];
export default function Harness() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return (
    <GridBoard projectId="00000000-0000-0000-0000-000000000000" projectName="P" brandNotes="" contentPillars="" igUsername="" igDisplayName=""
      igBio="" websiteUrl="" industry="" platform="instagram" profilePhotoUrl={null} postsPerWeek={0} storiesPerWeek={0} reelsPerWeek={0}
      newsletterPerWeek={0} instagramUrl="" tiktokUrl="" rows={ROWS} mediaLibrary={[]} mediaFolders={[]} canManage shareLinks={[]}
      shareTableMissing={false} demoMode />
  );
}
`;

let passed = 0;
let failed = 0;
let skipped = 0;
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL - ${name}\n   ${String(e.message).split("\n").slice(0, 8).join("\n   ")}`);
  }
}
// A scenario that throws (an element a broken build never renders, say) is a
// FAIL with its reason, and the run carries on -- never an aborted report.
async function guarded(label, fn) {
  try {
    await fn();
  } catch (e) {
    failed++;
    console.log(`FAIL - ${label}: scenario aborted -- ${String(e.message).split("\n")[0]}`);
  }
}
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);
async function unzip(buf) {
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files);
  const files = {};
  for (const n of names) files[n] = Buffer.from(await zip.files[n].async("uint8array"));
  return { names, files };
}
const route = (q) => fetch(`${BASE}/files?${q}`).then(async (r) => ({ ok: r.ok, buf: Buffer.from(await r.arrayBuffer()), headers: r.headers }));
const tq = (t) => (t ? `&t=${encodeURIComponent(JSON.stringify(t))}` : "");
const reel = (t) => ({ ...t, scope: "reel-cover", scopeVersion: 1 });

// INDEPENDENT model of the on-screen framing (grid-crop-overlay.tsx's CSS:
// cover-fit base, zoom, pan as a fraction of the fitted image, clamped to
// coverage; rotation 0). Returns the source pixel an output pixel shows.
function sourceAt(poster, t, frame, u, v) {
  const [w, h] = POSTERS[poster];
  const base = Math.max(frame.w / w, frame.h / h);
  const zoom = Math.max(t.scale, 1);
  const imgW = w * base, imgH = h * base;
  const slackX = (imgW * zoom - frame.w) / 2, slackY = (imgH * zoom - frame.h) / 2;
  const ox = Math.max(-slackX, Math.min(slackX, t.x * imgW)), oy = Math.max(-slackY, Math.min(slackY, t.y * imgH));
  return { sx: (u - frame.w / 2 - ox) / (base * zoom) + w / 2, sy: (v - frame.h / 2 - oy) / (base * zoom) + h / 2 };
}
// What a 3:4 Grid box of width bw shows at (u, v): the centred band of the 9:16 frame.
const bandAt = (poster, t, bw, u, v) => {
  const frame = { w: bw, h: (bw * 16) / 9 };
  return sourceAt(poster, t, frame, u, v + (frame.h - (bw * 4) / 3) / 2);
};
async function rgbAt(buf, x, y) {
  const { data } = await sharp(buf).extract({ left: Math.round(x), top: Math.round(y), width: 1, height: 1 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return [data[0], data[1], data[2]];
}
// every sample point's colour must decode to the source pixel the model expects
async function assertFraming(buf, poster, at, size, label, tol = 9, rows = [0.1, 0.3, 0.5, 0.7, 0.9]) {
  const [w, h] = POSTERS[poster];
  const errs = [];
  for (const fu of [0.12, 0.5, 0.88]) for (const fv of rows) {
    const u = size.w * fu, v = size.h * fv;
    const { sx, sy } = at(u, v);
    const exp = [(255 * sx) / (w - 1), (255 * sy) / (h - 1)];
    const got = await rgbAt(buf, u, v);
    if (Math.abs(got[0] - exp[0]) > tol || Math.abs(got[1] - exp[1]) > tol) errs.push(`(${fu},${fv}) got ${got[0]},${got[1]} want ${exp[0].toFixed(0)},${exp[1].toFixed(0)}`);
  }
  assert.equal(errs.length, 0, `${label}: ${errs.slice(0, 4).join(" | ")}`);
}
// the centred 3:4 band of a 9:16 image, whatever its pixel size
async function centreBand(buf) {
  const { width: w, height: h } = await sharp(buf).metadata();
  const bh = Math.round((w * 4) / 3);
  return sharp(buf).extract({ left: 0, top: Math.round((h - bh) / 2), width: w, height: bh }).png().toBuffer();
}
async function meanDiff(a, b, w = 36, h = 48) {
  const [ra, rb] = await Promise.all([a, b].map((x) => sharp(x).removeAlpha().resize(w, h, { fit: "fill" }).raw().toBuffer()));
  let s = 0;
  for (let i = 0; i < ra.length; i++) s += Math.abs(ra[i] - rb[i]);
  return s / ra.length;
}

async function partA() {
  console.log("\n### A. export -- real plan + renderer, measured against an independent model");
  const T1 = { scale: 1.25, x: 0.05, y: -0.04, rotation: 0 };
  for (const poster of ["reel-edited.jpg", "auto-portrait.jpg", "auto-landscape.jpg", "auto-square.jpg"]) {
    const zip = await unzip((await route(`poster=${poster}${tq(reel(T1))}`)).buf);
    await check(`A. ${poster}: Save Media zip = the untouched video + ONE 9:16 cover image at native resolution (<= 1080 wide, never upscaled), framed exactly as chosen`, async () => {
      assert.deepEqual(zip.names, ["cover.mp4", "cover-image.jpg"]);
      assert.equal(sha(zip.files["cover.mp4"]), sha((await route("fixture=p/reel.mp4")).buf), "video byte-for-byte");
      const { width: w, height: h } = await sharp(zip.files["cover-image.jpg"]).metadata();
      assert.ok(Math.abs(w / h - 9 / 16) < 0.01 && w <= 1080 && h <= POSTERS[poster][1], `${w}x${h}`);
      await assertFraming(zip.files["cover-image.jpg"], poster, (u, v) => sourceAt(poster, T1, { w, h }, u, v), { w, h }, poster);
    });
    await check(`A. ${poster}: the 3:4 Grid band (PDF / Full Feed render) is EXACTLY the centred 3:4 part of that exported 9:16 cover`, async () => {
      const cell = (await route(`cell=1&poster=${poster}${tq(reel(T1))}`)).buf;
      assert.equal((await sharp(cell).metadata()).height, 480);
      await assertFraming(cell, poster, (u, v) => bandAt(poster, T1, 360, u, v), { w: 360, h: 480 }, `${poster} band`);
      const d = await meanDiff(cell, await centreBand(zip.files["cover-image.jpg"]));
      assert.ok(d < 2.5, `band vs centre of the exported cover: mean diff ${d.toFixed(2)}`);
    });
  }
  await check("A. a rotated Reel framing: the Grid band still equals the centre of the exported cover", async () => {
    const T = reel({ scale: 1.4, x: 0.02, y: 0.03, rotation: 12 });
    const zip = await unzip((await route(`poster=auto-landscape.jpg${tq(T)}`)).buf);
    const cell = (await route(`cell=1&poster=auto-landscape.jpg${tq(T)}`)).buf;
    const d = await meanDiff(cell, await centreBand(zip.files["cover-image.jpg"]));
    assert.ok(d < 2.5, `mean diff ${d.toFixed(2)}`);
  });
  await check("A. per-frame Save Cover Image (route, single asset) is the same 1080x1920 framed cover as in the zip", async () => {
    const one = await route(`poster=auto-square.jpg${tq(reel(T1))}&asset=pa-v&part=cover-image`);
    const zip = await unzip((await route(`poster=auto-square.jpg${tq(reel(T1))}`)).buf);
    assert.equal(one.headers.get("x-filename"), "cover-image.jpg");
    assert.equal(sha(one.buf), sha(zip.files["cover-image.jpg"]));
  });
  await check("A. a Reel crop on a post that is now a CAROUSEL: no cover image (approved rule), files untouched", async () => {
    const zip = await unzip((await route(`poster=reel-edited.jpg&assets=carousel${tq(reel(T1))}`)).buf);
    assert.deepEqual(zip.names, ["cover.mp4", "slide-2.png"]);
    assert.equal(sha(zip.files["cover.mp4"]), sha((await route("fixture=p/reel.mp4")).buf));
  });
  await check("A. a Grid-preview crop on a Reel still exports the saved cover as is (byte-for-byte)", async () => {
    const zip = await unzip((await route(`poster=reel-edited.jpg${tq({ ...T1, scope: "grid-preview", scopeVersion: 1 })}`)).buf);
    assert.equal(sha(zip.files["cover-image.jpg"]), sha((await route("fixture=p/reel-edited.jpg")).buf));
  });
  await check("A. an UNCROPPED 4:5 automatic poster on a standalone Reel still exports a 9:16 cover (default centred framing, native size)", async () => {
    const zip = await unzip((await route("poster=auto-45.jpg")).buf);
    assert.deepEqual(zip.names, ["cover.mp4", "cover-image.jpg"]);
    const { width: w, height: h } = await sharp(zip.files["cover-image.jpg"]).metadata();
    assert.ok(Math.abs(w / h - 9 / 16) < 0.01 && h <= 1350, `${w}x${h}`);
    await assertFraming(zip.files["cover-image.jpg"], "auto-45.jpg", (u, v) => sourceAt("auto-45.jpg", { scale: 1, x: 0, y: 0 }, { w, h }, u, v), { w, h }, "auto-45 default");
  });
  await check("A. an uncropped 9:16 cover still ships byte-for-byte; an uncropped older 3:4 one stays 3:4", async () => {
    const z916 = await unzip((await route("poster=auto-portrait.jpg")).buf);
    assert.equal(sha(z916.files["cover-image.jpg"]), sha((await route("fixture=p/auto-portrait.jpg")).buf));
    const z34 = await unzip((await route("poster=legacy-34.jpg")).buf);
    assert.equal(sha(z34.files["cover-image.jpg"]), sha((await route("fixture=p/legacy-34.jpg")).buf));
  });
  await check("A. an older 3:4 Reel cover with its (unmarked) crop still exports a 3:4 cover image, as before", async () => {
    const zip = await unzip((await route(`poster=legacy-34.jpg${tq(T1)}`)).buf);
    const meta = await sharp(zip.files["cover-image.jpg"]).metadata();
    assert.ok(Math.abs(meta.width / meta.height - 0.75) < 0.01, `${meta.width}x${meta.height}`);
  });
}

// ---------------------------------------------------------------------------
// browser helpers
// ---------------------------------------------------------------------------
async function newPage(browser, media, { cfg, viewport = { width: 1400, height: 900 }, actionReply } = {}) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  if (cfg) await page.addInitScript((c) => { window.__cfg = c; }, cfg);
  await page.route("https://media.test/**", (r) => {
    const name = new URL(r.request().url()).pathname.slice(1);
    const m = media[name];
    if (!m) return r.fulfill({ status: 404 });
    const range = /bytes=(\d+)-(\d*)/.exec(r.request().headers()["range"] ?? "");
    const headers = { "access-control-allow-origin": "*", "Accept-Ranges": "bytes" };
    if (!range) return r.fulfill({ body: m[0], contentType: m[1], headers });
    const s = +range[1], e = range[2] ? Math.min(+range[2], m[0].length - 1) : m[0].length - 1;
    return r.fulfill({ status: 206, body: m[0].subarray(s, e + 1), contentType: m[1], headers: { ...headers, "Content-Range": `bytes ${s}-${e}/${m[0].length}` } });
  });
  const actions = [];
  const refreshes = [];
  await page.route(`http://localhost:${PORT}/**`, (r) => {
    const req = r.request();
    if (req.method() === "POST" && req.headers()["next-action"]) {
      const body = req.postData() ?? "";
      actions.push(body);
      // only the cover save gets the scripted reply; every other action (comments, ...) a plain null
      const reply = actionReply && body.includes("annotation_json") ? actionReply() : "null";
      return r.fulfill({ status: 200, contentType: "text/x-component", body: `0:{"a":"$@1","f":"","b":"dev"}\n1:${reply}\n` });
    }
    if (req.method() === "GET" && (req.headers()["rsc"] || /[?&]_rsc=/.test(req.url()))) refreshes.push(req.url());
    return r.fallback();
  });
  return { ctx, page, actions, refreshes };
}
const crop = (page) => page.locator("div.fixed[class~='z-[101]'] > div").first();
const actionArgs = (actions) =>
  actions.map((b) => { try { return JSON.parse(b); } catch { return null; } }).filter(Array.isArray);
// every framing written: an item's export frame (updatePostAssetFrameTransform) or a legacy cover crop
const writes = (actions) => actionArgs(actions).map((a) => a.find((x) => x && typeof x === "object" && "scale" in x)).filter(Boolean);
// every aspect ratio stored (setPostAspectRatio)
const aspectWrites = (actions) => actionArgs(actions).map((a) => a.find((x) => typeof x === "string" && /^(original|1:1|4:5|9:16)$/.test(x))).filter(Boolean);
const ef = (t, aspect = 9 / 16) => ({ ...t, scope: "export-frame", scopeVersion: 1, aspect });
async function panZoom(page) {
  const f = await crop(page).boundingBox();
  await page.mouse.move(f.x + f.width - 4, f.y + f.height - 4);
  await page.mouse.down();
  await page.mouse.move(f.x + f.width + 50, f.y + f.height + 50, { steps: 8 });
  await page.mouse.up();
  const f2 = await crop(page).boundingBox();
  await page.mouse.move(f2.x + f2.width / 2, f2.y + f2.height / 2);
  await page.mouse.down();
  await page.mouse.move(f2.x + f2.width / 2 - 30, f2.y + f2.height / 2 + 25, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}
async function bandShot(page) {
  const f = await crop(page).boundingBox();
  const b = await page.locator("[data-grid-band]").boundingBox();
  return page.screenshot({ clip: { x: f.x + 4, y: b.y + 4, width: f.width - 8, height: b.height - 8 } });
}

async function partB(engine, browser, media) {
  console.log(`\n### B. Post Editor -- ${engine} ${browser.version()}${engine === "webkit" ? " (Playwright build -- not Safari)" : ""}`);
  const tile = (page) => page.locator("[data-post-media-preview]").first();
  const openCrop = async (page) => {
    for (const end = Date.now() + 60000; ; ) {
      await page.locator("button[title='Frame options']").first().click();
      if (await page.getByRole("button", { name: "Crop", exact: true }).count()) break;
      if (Date.now() > end) throw new Error("frame menu never opened");
      await page.waitForTimeout(300);
    }
    await page.getByRole("button", { name: "Crop", exact: true }).click();
    await page.waitForTimeout(700);
  };
  const ready = async (page) => {
    await page.goto(`${BASE}/ui`, { waitUntil: "networkidle" });
    await page.waitForSelector("text=Close X", { timeout: 90000 });
    await page.waitForTimeout(1200);
  };
  const save = (page) => page.locator("div.fixed[class~='z-[101]']").getByRole("button", { name: "Save", exact: true }).click();

  for (const poster of ["reel-edited.jpg", "auto-landscape.jpg", "auto-square.jpg"]) {
    const s = await newPage(browser, media, { cfg: { t: null, kind: "reel", poster, annotation: { objects: [] } } });
    await ready(s.page);
    await openCrop(s.page);
    await check(`B. ${engine} ${poster}: Crop on a standalone Reel opens a 9:16 frame with a centred, full-width 3:4 Grid band`, async () => {
      const f = await crop(s.page).boundingBox();
      assert.ok(Math.abs(f.width / f.height - 9 / 16) < 0.01, `frame ${f.width}x${f.height}`);
      const b = await s.page.locator("[data-grid-band]").boundingBox();
      assert.ok(Math.abs(b.width / b.height - 0.75) < 0.02, `band ${b.width}x${b.height}`);
      assert.ok(Math.abs(b.y + b.height / 2 - (f.y + f.height / 2)) < 2, "band centred");
      assert.ok(Math.abs(b.width - f.width) < 2, "band full width");
      assert.equal(await s.page.getByText("Shown in Grid").count(), 1);
    });
    await panZoom(s.page);
    const editorBand = await bandShot(s.page);
    const before = s.refreshes.length;
    await save(s.page);
    await s.page.waitForTimeout(1500);
    const w = writes(s.actions);
    await check(`B. ${engine} ${poster}: Apply stores the 9:16 ratio + ONE frame for the cover item, and refreshes (so the Grid gets it)`, async () => {
      assert.equal(w.length, 1, JSON.stringify(w));
      assert.equal(w[0].scope, undefined, "a plain frame (post_assets.frame_transform), not a cover_transform marker");
      assert.deepEqual(aspectWrites(s.actions), ["9:16"]);
      assert.ok(s.refreshes.length > before, "router.refresh after the save");
    });
    const tileShot = await tile(s.page).screenshot();
    await check(`B. ${engine} ${poster}: the cover tile shows exactly the band -- model, the editor's band, and the server's band render`, async () => {
      const box = await tile(s.page).boundingBox();
      await assertFraming(tileShot, poster, (u, v) => bandAt(poster, w[0], box.width, u, v), { w: box.width, h: box.height }, "tile", 14, [0.3, 0.5, 0.7]); // the tile's corner badges cover its edge rows
      const d1 = await meanDiff(tileShot, editorBand);
      assert.ok(d1 < 6, `tile vs editor band: ${d1.toFixed(2)}`);
      const cell = (await route(`cell=1&poster=${poster}${tq(ef(w[0]))}`)).buf;
      const d2 = await meanDiff(tileShot, cell);
      assert.ok(d2 < 6, `tile vs server band render: ${d2.toFixed(2)}`);
    });
    await openCrop(s.page);
    await check(`B. ${engine} ${poster}: reopening Crop shows the saved framing`, async () => {
      const d = await meanDiff(await bandShot(s.page), editorBand);
      assert.ok(d < 4, `mean diff ${d.toFixed(2)}`);
    });
    await s.page.keyboard.press("Escape");
    await s.ctx.close();
    // a fresh mount with the stored value = a full page refresh
    const r = await newPage(browser, media, { cfg: { t: null, kind: "reel", poster, annotation: { objects: [] }, aspect: "9:16", frame: w[0] } });
    await ready(r.page);
    await check(`B. ${engine} ${poster}: after a refresh the tile still shows the saved band`, async () => {
      const d = await meanDiff(await tile(r.page).screenshot(), tileShot);
      assert.ok(d < 3, `mean diff ${d.toFixed(2)}`);
    });
    if (poster === "auto-square.jpg") {
      await check(`B. ${engine}: Save Cover Image for a Reel with this crop is rendered by the export route`, async () => {
        const reqs = [];
        r.page.on("request", (q) => reqs.push(q.url()));
        await r.page.locator("button[title='Frame options']").first().click();
        await r.page.getByRole("button", { name: "Download Cover Image", exact: true }).click();
        await r.page.waitForTimeout(800);
        assert.ok(reqs.some((u) => /\/export\?asset=pa-v&part=cover-image/.test(u)), reqs.filter((u) => !/_next|media\.test/.test(u)).join(" | "));
      });
    }
    await r.ctx.close();
  }

  {
    // a 4:5 automatic poster fills the 9:16 height: Apply WITHOUT moving it must still save the 9:16 framing
    const s = await newPage(browser, media, { cfg: { t: null, kind: "reel", poster: "auto-45.jpg", annotation: { objects: [] } } });
    await ready(s.page);
    await openCrop(s.page);
    await check(`B. ${engine} 4:5 automatic poster: the 9:16 editor with the band; Apply without moving saves ONE default reel-cover crop`, async () => {
      const f = await crop(s.page).boundingBox();
      assert.ok(Math.abs(f.width / f.height - 9 / 16) < 0.01, `frame ${f.width}x${f.height}`);
      assert.equal(await s.page.locator("[data-grid-band]").count(), 1);
      assert.ok(await s.page.getByText("Shown in Grid").isVisible());
      await save(s.page);
      await s.page.waitForTimeout(1200);
      const w = writes(s.actions);
      assert.equal(w.length, 1, JSON.stringify(w));
      assert.deepEqual(aspectWrites(s.actions), ["9:16"]);
    });
    await s.ctx.close();
  }
  {
    // ...and moving it up/down: at minimum zoom a 4:5 cover fills the 9:16 height (a real limit),
    // so the editor says so; the Zoom control opens up vertical room, and the drag then moves it.
    const s = await newPage(browser, media, { cfg: { t: null, kind: "reel", poster: "auto-45.jpg", annotation: { objects: [] } } });
    await ready(s.page);
    await openCrop(s.page);
    if (process.env.SHOT_DIR) await s.page.screenshot({ path: path.join(process.env.SHOT_DIR, `reel-crop-45-${engine}.png`) });
    await check(`B. ${engine} 4:5 cover: "Zoom in to move up or down" at minimum zoom; Zoom in, drag down, Apply -> saved zoom > 1 with a vertical offset`, async () => {
      assert.ok(await s.page.getByText("Zoom in to move up or down").isVisible());
      for (let i = 0; i < 4; i++) await s.page.getByRole("button", { name: "Zoom in", exact: true }).click();
      await s.page.waitForTimeout(200);
      assert.equal(await s.page.getByText("Zoom in to move up or down").count(), 0, "hint gone once there is vertical room");
      const f = await crop(s.page).boundingBox();
      await s.page.mouse.move(f.x + f.width / 2, f.y + f.height * 0.35);
      await s.page.mouse.down();
      await s.page.mouse.move(f.x + f.width / 2, f.y + f.height * 0.35 + 90, { steps: 8 });
      await s.page.mouse.up();
      await save(s.page);
      await s.page.waitForTimeout(1200);
      const w = writes(s.actions);
      assert.equal(w.length, 1, JSON.stringify(w));
      assert.deepEqual(aspectWrites(s.actions), ["9:16"]);
      assert.ok(w[0].scale > 1.3, `zoom ${w[0].scale}`);
      assert.ok(w[0].y > 0.01, `moved down: y ${w[0].y}`);
    });
    await s.ctx.close();
  }

  {
    // an older 3:4 Reel cover: opens in the 9:16 editor; open + cancel writes nothing; Apply stores 9:16 + frame
    const s = await newPage(browser, media, { cfg: { t: { scale: 1.2, x: 0, y: 0 }, kind: "reel", poster: "legacy-34.jpg", annotation: { objects: [] } } });
    await ready(s.page);
    const legacyTile = await tile(s.page).screenshot();
    await openCrop(s.page);
    await check(`B. ${engine} an older 3:4 Reel cover: the 9:16 editor with the band; opening + cancelling writes NOTHING and changes nothing`, async () => {
      const f = await crop(s.page).boundingBox();
      assert.ok(Math.abs(f.width / f.height - 9 / 16) < 0.01, `frame ${f.width}x${f.height}`);
      assert.equal(await s.page.locator("[data-grid-band]").count(), 1);
      await s.page.locator("div.fixed[class~='z-[101]']").getByRole("button", { name: "Cancel", exact: true }).click();
      await s.page.waitForTimeout(500);
      assert.deepEqual(writes(s.actions), []);
      assert.deepEqual(aspectWrites(s.actions), []);
      assert.ok((await meanDiff(await tile(s.page).screenshot(), legacyTile)) < 2, "legacy tile unchanged");
    });
    await openCrop(s.page);
    await save(s.page);
    await s.page.waitForTimeout(1200);
    await check(`B. ${engine} an older 3:4 Reel cover: Apply stores the 9:16 ratio + its frame`, async () => {
      assert.deepEqual(aspectWrites(s.actions), ["9:16"]);
      assert.equal(writes(s.actions).length, 1);
    });
    await s.ctx.close();
  }

  for (const [label, cfg, want] of [
    ["a video inside a carousel", { t: null, kind: "carousel", poster: "auto-portrait.jpg", annotation: { objects: [] } }, "grid-preview"],
  ]) {
    const s = await newPage(browser, media, { cfg });
    await ready(s.page);
    await openCrop(s.page);
    await check(`B. ${engine} ${label}: keeps the 3:4 crop frame (no Grid band)`, async () => {
      const f = await crop(s.page).boundingBox();
      assert.ok(Math.abs(f.width / f.height - 0.75) < 0.01, `frame ${f.width}x${f.height}`);
      assert.equal(await s.page.locator("[data-grid-band]").count(), 0);
    });
    await panZoom(s.page);
    await save(s.page);
    await s.page.waitForTimeout(1200);
    await check(`B. ${engine} ${label}: Apply saves ${want ? `a ${want}` : "an unmarked (3:4-exporting)"} crop`, async () => {
      const w = writes(s.actions);
      assert.equal(w.length, 1);
      assert.equal(w[0].scope, want);
    });
    await s.ctx.close();
  }
}

async function partC(browser, media) {
  console.log(`\n### C. Edit Cover keeps / resets the crop -- chromium ${browser.version()}`);
  const T = reel({ scale: 1.3, x: 0.04, y: -0.05, rotation: 0 });
  const tile = (page) => page.locator("[data-post-media-preview]").first();
  const ready = async (page) => {
    await page.goto(`${BASE}/ui`, { waitUntil: "networkidle" });
    await page.waitForSelector("text=Close X", { timeout: 90000 });
    await page.waitForTimeout(1200);
  };
  const editCover = async (page) => {
    for (const end = Date.now() + 60000; ; ) {
      await page.locator("button[title='Frame options']").first().click();
      if (await page.getByRole("button", { name: "Edit Cover", exact: true }).count()) break;
      if (Date.now() > end) throw new Error("frame menu never opened");
      await page.waitForTimeout(300);
    }
    await page.getByRole("button", { name: "Edit Cover", exact: true }).click();
  };
  const pickAndSave = async (page) => {
    await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Use This Frame" && !b.disabled), null, { timeout: 60000 });
    await page.getByRole("button", { name: "Use This Frame" }).click();
    await page.locator(".canvas-container").waitFor({ timeout: 60000 });
    await page.waitForTimeout(800);
    // the image editor's own Save (the Post Editor's form submit has the same label)
    await page.locator("button[type=button]").filter({ hasText: /^Save Changes$/ }).click();
    await page.waitForTimeout(1500);
  };
  for (const kept of [true, false]) {
    const s = await newPage(browser, media, {
      cfg: { t: T, kind: "reel", poster: "reel-edited.jpg", annotation: null },
      actionReply: () => JSON.stringify({ previewUrl: `${M}reel-edited.jpg`, coverFramingKept: kept }),
    });
    await ready(s.page);
    const croppedTile = await tile(s.page).screenshot();
    await editCover(s.page);
    await pickAndSave(s.page);
    await check(`C. Edit Cover saved and the server ${kept ? "KEPT" : "RESET"} the crop -> the tile ${kept ? "keeps the band" : "shows the cover uncropped, with a notice"}`, async () => {
      const d = await meanDiff(await tile(s.page).screenshot(), croppedTile);
      if (kept) assert.ok(d < 3, `tile changed: ${d.toFixed(2)}`);
      else {
        assert.ok(d > 8, `tile still cropped: ${d.toFixed(2)}`);
        assert.equal(await s.page.getByText(/crop was reset because the cover image changed/).count(), 1);
      }
    });
    if (kept) {
      await editCover(s.page);
      await s.page.waitForTimeout(4000);
      await check("C. reopening Edit Cover after a save restores THAT save -- not the frame picker again", async () => {
        assert.equal(await s.page.getByRole("button", { name: "Use This Frame" }).count(), 0, "frame picker shown: the editor got a stale (empty) edit");
      });
    }
    await s.ctx.close();
  }
}

async function partD(engine, browser, media) {
  console.log(`\n### D. Grid -- ${engine} ${browser.version()}`);
  const s = await newPage(browser, media, {});
  await s.page.goto(`${BASE}/grid`, { waitUntil: "networkidle" });
  await s.page.locator("button[title='Slot options']").first().waitFor({ timeout: 90000 });
  await s.page.waitForTimeout(1200);
  const tileOf = (name) => s.page.locator(`img[src$='${name}']`).first().locator("xpath=..");
  const openCrop = async (i) => {
    await s.page.locator("button[title='Slot options']").nth(i).click();
    await s.page.getByRole("button", { name: "Crop Image", exact: true }).click();
    await s.page.waitForTimeout(700);
  };
  await openCrop(0);
  await check(`D. ${engine}: Grid Crop on a standalone Reel opens the same enlarged 9:16 editor with the Grid band`, async () => {
    const f = await crop(s.page).boundingBox();
    assert.ok(Math.abs(f.width / f.height - 9 / 16) < 0.01, `frame ${f.width}x${f.height}`);
    assert.equal(await s.page.locator("[data-grid-band]").count(), 1);
  });
  await panZoom(s.page);
  const editorBand = await bandShot(s.page);
  await s.page.locator("div.fixed[class~='z-[101]']").getByRole("button", { name: "Save", exact: true }).click();
  await s.page.waitForTimeout(1000);
  await check(`D. ${engine}: ...and the Reel's Grid tile then shows exactly that band`, async () => {
    const d = await meanDiff(await tileOf("reel-edited.jpg").screenshot(), editorBand);
    assert.ok(d < 6, `tile vs editor band: ${d.toFixed(2)}`);
  });
  await openCrop(1);
  await check(`D. ${engine}: a carousel video's Grid Crop still crops in place, at 3:4, without the band`, async () => {
    const f = await crop(s.page).boundingBox();
    assert.ok(Math.abs(f.width / f.height - 0.75) < 0.01, `frame ${f.width}x${f.height}`);
    assert.equal(await s.page.locator("[data-grid-band]").count(), 0);
  });
  await s.page.locator("div.fixed[class~='z-[101]']").getByRole("button", { name: "Cancel", exact: true }).click();
  await s.page.waitForTimeout(300);
  await openCrop(2);
  await check(`D. ${engine}: an older 3:4 Reel cover now opens the same 9:16 editor (changes only on Apply)`, async () => {
    const f = await crop(s.page).boundingBox();
    assert.ok(Math.abs(f.width / f.height - 9 / 16) < 0.01, `frame ${f.width}x${f.height}`);
    assert.equal(await s.page.locator("[data-grid-band]").count(), 1);
  });
  await s.ctx.close();
}

// --- E. export per chosen aspect ratio (real plan + renderer) ----------------
async function partE() {
  console.log("\n### E. aspect ratio export -- real plan + renderer, measured");
  const zipOf = async (q) => unzip((await route(q)).buf);
  const dims = async (buf) => {
    const m = await sharp(buf).metadata();
    return [m.width, m.height];
  };
  const fr = (o) => `&frames=${encodeURIComponent(JSON.stringify(o))}`;
  await check("E. Post, Original: the landscape photo keeps its own 1.6 ratio and full composition, at its native 768x480 (no 4:5, no upscale)", async () => {
    const z = await zipOf("assets=post&poster=img-768x480.jpg&aspect=original");
    assert.deepEqual(z.names, ["cover.jpg"]);
    assert.deepEqual(await dims(z.files["cover.jpg"]), [768, 480]);
    await assertFraming(z.files["cover.jpg"], "img-768x480.jpg", (u, v) => sourceAt("img-768x480.jpg", { scale: 1, x: 0, y: 0 }, { w: 768, h: 480 }, u, v), { w: 768, h: 480 }, "original");
  });
  await check("E. Post, 1:1: a square crop of it at native resolution (480x480), centred", async () => {
    const z = await zipOf("assets=post&poster=img-768x480.jpg&aspect=1:1");
    assert.deepEqual(await dims(z.files["cover.jpg"]), [480, 480]);
    await assertFraming(z.files["cover.jpg"], "img-768x480.jpg", (u, v) => sourceAt("img-768x480.jpg", { scale: 1, x: 0, y: 0 }, { w: 480, h: 480 }, u, v), { w: 480, h: 480 }, "1:1");
  });
  await check("E. Post, 4:5 with a saved frame: exactly 4:5, that framing, never wider than the source allows", async () => {
    const t = { scale: 1.2, x: 0.05, y: 0 };
    const z = await zipOf(`assets=post&poster=img-768x480.jpg&aspect=4:5${fr({ "pa-i": t })}`);
    const [w, h] = await dims(z.files["cover.jpg"]);
    assert.ok(Math.abs(w / h - 0.8) < 0.01 && w <= 768, `${w}x${h}`);
    await assertFraming(z.files["cover.jpg"], "img-768x480.jpg", (u, v) => sourceAt("img-768x480.jpg", t, { w, h }, u, v), { w, h }, "4:5 framed");
  });
  await check("E. a wider-than-1080 source is capped at 1080 wide (1280x720 Original -> 1080x608)", async () => {
    const z = await zipOf("assets=post&poster=auto-landscape.jpg&aspect=original");
    assert.deepEqual(await dims(z.files["cover.jpg"]), [1080, 608]);
  });
  await check("E. Reel cover at 9:16 from a 720x1280 poster: 720x1280 (never upscaled to 1080x1920); the video byte-for-byte", async () => {
    const z = await zipOf("poster=auto-portrait.jpg&aspect=9:16");
    assert.deepEqual(z.names, ["cover.mp4", "cover-image.jpg"]);
    assert.deepEqual(await dims(z.files["cover-image.jpg"]), [720, 1280]);
    assert.equal(sha(z.files["cover.mp4"]), sha((await route("fixture=p/reel.mp4")).buf));
  });
  await check("E. Carousel at 4:5: every IMAGE is 4:5 with its own frame; the video file is untouched (no cover JPG)", async () => {
    const t3 = { scale: 1.3, x: 0.1, y: 0 };
    const z = await zipOf(`assets=carousel3&aspect=4:5${fr({ "pa-3": t3 })}`);
    assert.deepEqual(z.names, ["cover.jpg", "slide-2.mp4", "slide-3.jpg"]);
    for (const n of ["cover.jpg", "slide-3.jpg"]) {
      const [w, h] = await dims(z.files[n]);
      assert.ok(Math.abs(w / h - 0.8) < 0.01, `${n} ${w}x${h}`);
    }
    assert.equal(sha(z.files["slide-2.mp4"]), sha((await route("fixture=p/reel.mp4")).buf));
    const [w3, h3] = await dims(z.files["slide-3.jpg"]);
    await assertFraming(z.files["slide-3.jpg"], "auto-square.jpg", (u, v) => sourceAt("auto-square.jpg", t3, { w: w3, h: h3 }, u, v), { w: w3, h: h3 }, "slide 3");
  });
  await check("E. the Grid's 3:4 tile of a 1:1 post = the centred 3:4 window of the exported square (Grid stays 3:4)", async () => {
    const t = { scale: 1.2, x: 0.05, y: 0 };
    const z = await zipOf(`assets=post&poster=auto-square.jpg&aspect=1:1${fr({ "pa-i": t })}`);
    const [w, h] = await dims(z.files["cover.jpg"]);
    const winW = Math.round(h * 0.75);
    const win = await sharp(z.files["cover.jpg"]).extract({ left: Math.round((w - winW) / 2), top: 0, width: winW, height: h }).png().toBuffer();
    const cell = (await route(`cell=1&poster=auto-square.jpg${tq(ef(t, 1))}`)).buf;
    assert.deepEqual(await dims(cell), [360, 480]);
    const d = await meanDiff(cell, win);
    assert.ok(d < 2.5, `mean diff ${d.toFixed(2)}`);
  });
}

// --- F. Post Editor: the Aspect Ratio selector and carousel framing ---------
async function partF(browser, media) {
  console.log(`\n### F. Post Editor aspect ratio -- chromium ${browser.version()}`);
  const ready = async (page) => {
    await page.goto(`${BASE}/ui`, { waitUntil: "networkidle" });
    await page.waitForSelector("text=Close X", { timeout: 90000 });
    await page.waitForTimeout(1200);
  };
  const pill = (page, name) => page.locator("[data-aspect-selector] button").filter({ hasText: new RegExp(`^${name}`) });
  {
    const s = await newPage(browser, media, { cfg: { t: null, kind: "post", poster: "img-768x480.jpg", annotation: null } });
    await ready(s.page);
    await check("F. a Post offers Original / 1:1 / 4:5 (no 9:16); nothing is chosen or written until clicked", async () => {
      const labels = await s.page.locator("[data-aspect-selector] button").allInnerTexts();
      assert.deepEqual(labels.map((l) => l.trim()), ["Original", "1:1", "4:5"]);
      assert.deepEqual(aspectWrites(s.actions), []);
    });
    await pill(s.page, "1:1").click();
    await s.page.waitForTimeout(800);
    await check("F. choosing 1:1 stores it (one write) and the selector shows it", async () => {
      assert.deepEqual(aspectWrites(s.actions), ["1:1"]);
      assert.equal(await pill(s.page, "1:1").getAttribute("aria-pressed"), "true");
    });
    await s.ctx.close();
  }
  {
    // the tile itself takes the chosen ratio, immediately; Crop uses the same frame
    const s = await newPage(browser, media, { cfg: { t: null, kind: "post", poster: "img-768x480.jpg", annotation: null, aspect: "4:5" } });
    await ready(s.page);
    const tileRatio = async () => {
      const b = await s.page.locator("[data-post-media-preview]").first().locator("..").boundingBox(); // the tile, border included
      return +(b.width / b.height).toFixed(2);
    };
    await check("F. a stored 4:5 shows a 4:5 tile in the Post Editor", async () => assert.equal(await tileRatio(), 0.8));
    await pill(s.page, "1:1").click();
    await s.page.waitForTimeout(800);
    await check("F. switching 4:5 -> 1:1 makes the tile square right away", async () => assert.equal(await tileRatio(), 1));
    await s.page.locator("button[title='Frame options']").first().click();
    await s.page.getByRole("button", { name: "Crop", exact: true }).click();
    await s.page.waitForTimeout(700);
    await check("F. ...and Crop works in that same square frame", async () => {
      const f = await crop(s.page).boundingBox();
      assert.ok(Math.abs(f.width / f.height - 1) < 0.01, `frame ${f.width}x${f.height}`);
    });
    await s.page.keyboard.press("Escape");
    await s.page.waitForTimeout(500);
    await pill(s.page, "Original").click();
    await s.page.waitForTimeout(800);
    await check("F. switching to Original gives the source's own 1.6 ratio", async () => assert.equal(await tileRatio(), 1.6));
    await s.ctx.close();
  }
  {
    const s = await newPage(browser, media, { cfg: { t: null, kind: "post", poster: "auto-portrait.jpg", annotation: null, aspect: "original" } });
    await ready(s.page);
    await check("F. Original outside Instagram's feed range warns (a 9:16 photo) -- and nothing is cropped automatically", async () => {
      assert.equal(await s.page.getByText(/outside what Instagram's feed accepts/).count(), 1);
      assert.deepEqual(writes(s.actions), []);
    });
    await s.ctx.close();
  }
  {
    const s = await newPage(browser, media, { cfg: { t: null, kind: "carousel3", poster: "auto-portrait.jpg", annotation: null, aspect: "4:5" } });
    await ready(s.page);
    await check("F. a carousel's video slide says its file is downloaded unchanged", async () => {
      assert.equal(await s.page.getByText("Video file unchanged").count(), 1);
    });
    // slide 3's own Crop: the shared 4:5 frame, no Grid window (not the cover)
    await s.page.locator("button[title='Frame options']").nth(2).click();
    await s.page.getByRole("button", { name: "Crop", exact: true }).click();
    await s.page.waitForTimeout(700);
    await check("F. slide 3's Crop works in the carousel's shared 4:5 frame (no Grid guide: it isn't the cover)", async () => {
      const f = await crop(s.page).boundingBox();
      assert.ok(Math.abs(f.width / f.height - 0.8) < 0.01, `frame ${f.width}x${f.height}`);
      assert.equal(await s.page.locator("[data-grid-band]").count(), 0);
    });
    await panZoom(s.page);
    await s.page.locator("div.fixed[class~='z-[101]']").getByRole("button", { name: "Save", exact: true }).click();
    await s.page.waitForTimeout(1200);
    await check("F. Apply writes ONLY slide 3's own frame (the ratio was already stored)", async () => {
      const frameCalls = actionArgs(s.actions).filter((a) => a.some((x) => x && typeof x === "object" && "scale" in x));
      assert.equal(frameCalls.length, 1);
      assert.ok(frameCalls[0].includes("pa-3"), JSON.stringify(frameCalls[0]));
      assert.deepEqual(aspectWrites(s.actions), []);
    });
    await s.ctx.close();
  }
}

async function recordVideo(browser) {
  const page = await browser.newPage();
  const b64 = await page.evaluate(async () => {
    const c = Object.assign(document.createElement("canvas"), { width: 360, height: 640 });
    const ctx = c.getContext("2d");
    const rec = new MediaRecorder(c.captureStream(30), { mimeType: "video/webm" });
    const chunks = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.start();
    const t0 = performance.now();
    await new Promise((done) => (function f() {
      ctx.fillStyle = "#4a6"; ctx.fillRect(0, 0, 360, 640);
      ctx.fillStyle = "#222"; ctx.fillRect(100, 200, 160, 160);
      if (performance.now() - t0 < 1500) requestAnimationFrame(f); else done();
    })());
    rec.stop();
    await new Promise((r) => (rec.onstop = r));
    const buf = await new Blob(chunks, { type: "video/webm" }).arrayBuffer();
    let s = "";
    for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
    return btoa(s);
  });
  await page.close();
  return Buffer.from(b64, "base64");
}

async function waitForServer(url, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`dev server didn't come up at ${url}`);
}

if (fs.existsSync(HARNESS_DIR)) {
  console.error(`Refusing to run: ${HARNESS_DIR} already exists.`);
  process.exit(1);
}
let server;
const browsers = [];
try {
  fs.mkdirSync(path.join(HARNESS_DIR, "files"), { recursive: true });
  fs.mkdirSync(path.join(HARNESS_DIR, "ui"), { recursive: true });
  fs.mkdirSync(path.join(HARNESS_DIR, "grid"), { recursive: true });
  fs.writeFileSync(path.join(HARNESS_DIR, "files", "route.ts"), ROUTE);
  fs.writeFileSync(path.join(HARNESS_DIR, "ui", "page.tsx"), UI);
  fs.writeFileSync(path.join(HARNESS_DIR, "grid", "page.tsx"), GRID);
  server = spawn(`npx next dev --port ${PORT}`, { cwd: ROOT, shell: true, stdio: "ignore" });
  await waitForServer(`${BASE}/files?fixture=p/slide.png`, 300000);
  // ONLY=EF (etc.) runs just those parts
  const on = (p) => !process.env.ONLY || process.env.ONLY.includes(p);
  if (on("A")) await partA();
  if (on("E")) await partE();
  const cr = await chromium.launch();
  browsers.push(cr);
  const media = { "reel.webm": [await recordVideo(cr), "video/webm"], "slide.png": [(await route("fixture=p/slide.png")).buf, "image/png"] };
  for (const name of Object.keys(POSTERS)) media[name] = [(await route(`fixture=p/${name}`)).buf, "image/jpeg"];
  if (on("B")) await guarded("B. chromium", () => partB("chromium", cr, media));
  if (on("C")) await guarded("C. chromium", () => partC(cr, media));
  if (on("D")) await guarded("D. chromium", () => partD("chromium", cr, media));
  if (on("F")) await guarded("F. chromium", () => partF(cr, media));
  if (on("B") || on("D")) {
  const wk = await webkit.launch();
  browsers.push(wk);
  if (on("B")) await guarded("B. webkit", () => partB("webkit", wk, media));
  if (on("D")) await guarded("D. webkit", () => partD("webkit", wk, media));
  skipped += 2;
  console.log("SKIP - webkit: C. Edit Cover keep/reset + reopen (this browser build can't decode the WebM fixture the frame picker needs)");
  }
} finally {
  for (const b of browsers) await b.close().catch(() => {});
  if (server?.pid) {
    try {
      if (process.platform === "win32") execSync(`taskkill /pid ${server.pid} /T /F`, { stdio: "ignore" });
      else process.kill(-server.pid);
    } catch {
      // already gone
    }
  }
  fs.rmSync(HARNESS_DIR, { recursive: true, force: true });
  fs.rmSync(path.join(ROOT, ".next", "dev", "types"), { recursive: true, force: true });
}
console.log(`\n${passed} checks passed, ${failed} failed, ${skipped} skipped`);
if (failed) process.exit(1);
