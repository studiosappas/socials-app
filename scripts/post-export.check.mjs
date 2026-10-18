// Opt-in MEASURED regression check for "Download Media" exporting the saved,
// edited result (and "Download Originals" exporting the untouched uploads).
// Not part of the default test run: it starts a Next dev server and needs
// Playwright's Chromium AND WebKit (npx playwright install chromium webkit).
//
//   node scripts/post-export.check.mjs
//
// Three parts, all on fixtures -- no database, no storage, no real media:
//
//  A. EXPORT PIPELINE, measured. A TEMPORARY route handler runs the REAL
//     planPostExport + renderPostExport (the exact code the real export
//     route runs, including sharp's applyCoverTransform and JSZip) over
//     synthetic images whose pixels encode their own position. This script
//     then opens the returned files with sharp and checks pixel dimensions,
//     byte-identity and WHICH pixels are in the crop against expectations
//     derived independently from the on-screen CSS model, not from
//     applyCoverTransform.
//  B. SAVED-EDIT RESOLUTION, measured. A TEMPORARY page runs the REAL
//     annotation engine save path (buildAnnotationCanvas +
//     exportAndSaveAnnotation -- the one code path that ever writes a saved
//     edit) and reports the pixel size of the JPEG it would upload.
//  C. POST EDITOR UI. The REAL PostEditor on fixture assets: which request
//     each download action makes, on desktop and on a touch device.
//
// Everything temporary lives under one proxy-public folder that is ALWAYS
// deleted again (finally). What this does NOT cover: the real route's own
// Supabase queries/auth (not reachable without a database), and real Safari
// / a real phone -- Playwright's WebKit is not Safari.

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
const HARNESS_DIR = path.join(ROOT, "src", "app", "preview-post-export-harness-check");
const PORT = 3127;
const BASE = `http://localhost:${PORT}/preview-post-export-harness-check`;
const PROJECT = "00000000-0000-0000-0000-000000000000";
const POST = "00000000-0000-0000-0000-000000000001";
const EXPORT_PATH = `/projects/${PROJECT}/posts/${POST}/export`;

// ---------------------------------------------------------------------------
// A. temporary route: real export code over self-describing fixtures
// ---------------------------------------------------------------------------
const ROUTE = `// TEMPORARY -- created and deleted by scripts/post-export.check.mjs. Never commit.
import sharp from "sharp";
import JSZip from "jszip";
import { parseExportPart, parseExportVariant, planPostExport, type PostExportAsset } from "@/lib/post-export-plan";
import { PostExportError, contentTypeForFilename, renderPostExport } from "@/lib/post-export";

const quad = (w: number, h: number, colors: string[]) =>
  sharp({ create: { width: w, height: h, channels: 3, background: colors[0] } }).composite([
    { input: { create: { width: w / 2, height: h / 2, channels: 3, background: colors[1] } }, left: w / 2, top: 0 },
    { input: { create: { width: w / 2, height: h / 2, channels: 3, background: colors[2] } }, left: 0, top: h / 2 },
    { input: { create: { width: w / 2, height: h / 2, channels: 3, background: colors[3] } }, left: w / 2, top: h / 2 },
  ]);
// Vertical 100px stripes; stripe i is rgb(i*10, 255 - i*10, 128): a pixel's colour tells you its source column.
async function stripes(w: number, h: number) {
  const raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = Math.floor(x / 100), o = (y * w + x) * 3;
    raw[o] = i * 10; raw[o + 1] = 255 - i * 10; raw[o + 2] = 128;
  }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}
let cache: Promise<Map<string, Buffer>> | null = null;
function fixtures() {
  cache ??= (async () => {
    const m = new Map<string, Buffer>();
    // ORIGINAL a: 3000x4000, quadrants red / green / blue / yellow.
    m.set("p/orig-a.png", await quad(3000, 4000, ["#ff0000", "#00ff00", "#0000ff", "#ffff00"]).png().toBuffer());
    // SAVED EDIT of a: a 4:5 crop at 1600x2000 with DIFFERENT colours (cyan / magenta / white / black),
    // so any export that contains red/green/blue/yellow provably started from the original.
    m.set("p/edit-a-preview.jpg", await quad(1600, 2000, ["#00ffff", "#ff00ff", "#ffffff", "#000000"]).jpeg({ quality: 92 }).toBuffer());
    m.set("p/orig-b.png", await stripes(2400, 1800));
    m.set("p/orig-c.png", await sharp({ create: { width: 1200, height: 1500, channels: 3, background: "#ff8800" } }).png().toBuffer());
    m.set("p/edit-c-preview.jpg", await quad(1200, 1500, ["#101010", "#404040", "#808080", "#c0c0c0"]).jpeg({ quality: 92 }).toBuffer());
    const video = Buffer.alloc(70000);
    for (let i = 0; i < video.length; i++) video[i] = (i * 31 + 7) % 251;
    m.set("p/orig-v.mp4", video);
    // A second, different video file, and two video covers: an EDITED cover (3:4, 1080x1440,
    // quadrants orange / purple / teal / pink) and an AUTOMATIC poster (9:16, 720x1280, plain grey).
    m.set("p/orig-w.mp4", Buffer.from(video.map((b) => 255 - b)));
    m.set("p/poster-v-edit.jpg", await quad(1080, 1440, ["#ff8000", "#8000ff", "#008080", "#ff69b4"]).jpeg({ quality: 92 }).toBuffer());
    m.set("p/poster-w-auto.jpg", await sharp({ create: { width: 720, height: 1280, channels: 3, background: "#777777" } }).jpeg({ quality: 92 }).toBuffer());
    return m;
  })();
  return cache;
}
const A: PostExportAsset = { postAssetId: "pa-a", mediaType: "image", storagePath: "p/orig-a.png", previewPath: "p/edit-a-preview.jpg" };
const A_UNEDITED: PostExportAsset = { ...A, previewPath: null };
const B: PostExportAsset = { postAssetId: "pa-b", mediaType: "image", storagePath: "p/orig-b.png", previewPath: null };
const C: PostExportAsset = { postAssetId: "pa-c", mediaType: "image", storagePath: "p/orig-c.png", previewPath: "p/edit-c-preview.jpg" };
const V: PostExportAsset = { postAssetId: "pa-v", mediaType: "video", storagePath: "p/orig-v.mp4", previewPath: null };
const GONE: PostExportAsset = { postAssetId: "pa-gone", mediaType: "image", storagePath: "p/does-not-exist.png", previewPath: null };
// a video whose cover was saved through Edit Cover, and one with only its automatic poster
const VE: PostExportAsset = { postAssetId: "pa-ve", mediaType: "video", storagePath: "p/orig-v.mp4", previewPath: null, posterPath: "p/poster-v-edit.jpg", coverEdited: true };
const VA: PostExportAsset = { postAssetId: "pa-va", mediaType: "video", storagePath: "p/orig-w.mp4", previewPath: null, posterPath: "p/poster-w-auto.jpg", coverEdited: false };
const SCENARIOS: Record<string, { assets: PostExportAsset[]; transform: { scale: number; x: number; y: number; rotation?: number } | null }> = {
  // edited + framed cover, untouched slide, edited slide, video
  carousel: { assets: [A, B, C, V], transform: { scale: 2, x: 0, y: 0 } },
  // same post, nobody framed the cover
  "carousel-unframed": { assets: [A, B, C, V], transform: null },
  // untouched cover with a Grid framing: zoom 2, panned right by a quarter of the image
  "framed-original": { assets: [B], transform: { scale: 2, x: 0.25, y: 0 } },
  // unedited cover, framed: must start from the ORIGINAL pixels
  "framed-unedited-a": { assets: [A_UNEDITED], transform: { scale: 2, x: 0, y: 0 } },
  "missing-slide": { assets: [B, GONE, C], transform: null },
  // untouched cover image, a video with an edited cover, a video with only its automatic poster
  "video-covers": { assets: [B, VE, VA], transform: null },
  // a video as the post's cover, with a Grid framing: on its edited cover / on its automatic poster
  "framed-video-edited": { assets: [VE, B], transform: { scale: 2, x: 0, y: 0 } },
  "framed-video-auto": { assets: [VA], transform: { scale: 2, x: 0, y: 0 } },
  // the same edited video cover, framed with a 90-degree rotation
  "framed-video-rotated": { assets: [VE], transform: { scale: 1, x: 0, y: 0, rotation: 90 } },
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const files = await fixtures();
  const fixture = url.searchParams.get("fixture");
  if (fixture) {
    const buf = files.get(fixture);
    return buf ? new Response(new Uint8Array(buf)) : new Response("no such fixture", { status: 404 });
  }
  const scenario = SCENARIOS[url.searchParams.get("scenario") ?? ""];
  if (!scenario) return new Response("no such scenario", { status: 400 });
  const variant = parseExportVariant(url.searchParams.get("variant"));
  const only = url.searchParams.get("asset");
  const part = parseExportPart(url.searchParams.get("part"));
  let plan = planPostExport(scenario.assets, scenario.transform, variant);
  if (only) {
    plan = plan.filter((i) => i.postAssetId === only && i.part === part);
    if (plan.length === 0) return Response.json({ message: "no such item" }, { status: 404 });
  }
  let rendered;
  try {
    rendered = await renderPostExport(plan, scenario.transform, async (p) => files.get(p) ?? null);
  } catch (error) {
    if (error instanceof PostExportError) return Response.json({ message: error.userMessage }, { status: 502 });
    throw error;
  }
  if (only) {
    return new Response(new Uint8Array(rendered[0].data), { headers: { "Content-Type": contentTypeForFilename(rendered[0].item.filename), "X-Filename": rendered[0].item.filename } });
  }
  const zip = new JSZip();
  for (const { item, data } of rendered) zip.file(item.filename, data);
  return new Response(new Uint8Array(await zip.generateAsync({ type: "nodebuffer" })), { headers: { "Content-Type": "application/zip" } });
}
`;

// ---------------------------------------------------------------------------
// B. temporary page: the real saved-edit export path
// ---------------------------------------------------------------------------
const EDITOR_PAGE = `"use client";
// TEMPORARY -- created and deleted by scripts/post-export.check.mjs. Never commit.
import { useEffect } from "react";
import * as fabric from "fabric";
import { buildAnnotationCanvas, exportAndSaveAnnotation, findBasePhoto, disposeAnnotationCanvas } from "@/lib/annotation-engine";
import { applyAdjustments, NEUTRAL_ADJUSTMENTS } from "@/lib/image-adjustments";
export default function Page() {
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__measureSavedEdit = async (imageUrl: string, aspect: { w: number; h: number }) => {
      const { canvas, exportScale } = await buildAnnotationCanvas({ imageUrl, annotationJson: null, targetAspect: aspect });
      // A real edit: an adjustment on the photo plus a drawn shape on top.
      const base = findBasePhoto(canvas);
      if (base) applyAdjustments(base, { ...NEUTRAL_ADJUSTMENTS, brightness: 10 });
      canvas.add(new fabric.Rect({ left: 20, top: 20, width: 80, height: 40, fill: "#ff0000" }));
      let out: { w: number; h: number; bytes: number; type: string } | null = null;
      const result = await exportAndSaveAnnotation({
        canvas, exportScale, projectId: "p", attachmentId: "a",
        saveAction: async (_p, _a, formData) => {
          const file = formData.get("file") as File;
          const bmp = await createImageBitmap(file);
          out = { w: bmp.width, h: bmp.height, bytes: file.size, type: file.type };
          return { previewUrl: "captured" };
        },
      });
      const frame = { canvasW: canvas.getWidth(), canvasH: canvas.getHeight(), exportScale, baseScale: base?.scaleX ?? null };
      disposeAnnotationCanvas(canvas);
      return { out, frame, result };
    };
    document.body.dataset.ready = "1";
  }, []);
  return <p>saved-edit measurement harness</p>;
}
`;

// ---------------------------------------------------------------------------
// C. temporary page: the real PostEditor
// ---------------------------------------------------------------------------
const UI_PAGE = `"use client";
// TEMPORARY -- created and deleted by scripts/post-export.check.mjs. Never commit.
import { useSearchParams } from "next/navigation";
import { Modal } from "../../projects/[projectId]/modal";
import { PostEditor, type PostAssetItem } from "../../projects/[projectId]/posts/[postId]/post-editor";
const M = "https://media.test/";
const ASSETS: PostAssetItem[] = [
  // cover: has a saved edit
  { postAssetId: "pa-1", mediaAssetId: "m-1", url: M + "edit-1-preview.jpg", originalUrl: M + "orig-1.png", annotationJson: null, mediaType: "image", posterUrl: null },
  // untouched slide
  { postAssetId: "pa-2", mediaAssetId: "m-2", url: M + "orig-2.png", originalUrl: M + "orig-2.png", annotationJson: null, mediaType: "image", posterUrl: null },
  // edited slide
  { postAssetId: "pa-3", mediaAssetId: "m-3", url: M + "edit-3-preview.jpg", originalUrl: M + "orig-3.png", annotationJson: null, mediaType: "image", posterUrl: null },
  // video with only its automatic poster
  { postAssetId: "pa-4", mediaAssetId: "m-4", url: M + "video-4.webm", originalUrl: M + "video-4.webm", annotationJson: null, mediaType: "video", posterUrl: M + "poster-4.jpg" },
  // video whose cover was saved through Edit Cover
  { postAssetId: "pa-5", mediaAssetId: "m-5", url: M + "video-5.webm", originalUrl: M + "video-5.webm", annotationJson: { objects: [] }, mediaType: "video", posterUrl: M + "poster-5-edit.jpg" },
];
// ?order=video-first: the automatic-poster video becomes the post's cover
const VIDEO_FIRST: PostAssetItem[] = [ASSETS[3], ASSETS[0], ASSETS[1], ASSETS[2], ASSETS[4]];
const NO_LINKS: never[] = [];
const NO_MEMBERS: never[] = [];
const LIBRARY = Promise.resolve([]);
const FRAMED = { id: "${POST}", post_type: "carousel" as const, caption: "", notes: "", scheduled_date: null, scheduled_time: null, status: "draft" as const, review_status: "pending" as const, coverTransform: { scale: 2, x: 0, y: 0, rotation: 0 } };
const UNFRAMED = { ...FRAMED, coverTransform: null };
export default function Harness() {
  const params = useSearchParams();
  const framed = params.get("framing") !== "off";
  const assets = params.get("order") === "video-first" ? VIDEO_FIRST : ASSETS;
  return (
    <Modal onClose={() => {}}>
      <PostEditor projectId="${PROJECT}" post={framed ? FRAMED : UNFRAMED} assets={assets} links={NO_LINKS} mediaLibraryPromise={LIBRARY}
        canManage role="owner" currentUserId="00000000-0000-0000-0000-000000000002" members={NO_MEMBERS} dateFormat="DD/MM/YYYY" hideBackLink />
    </Modal>
  );
}
`;

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL - ${name}\n   ${String(e.message).split("\n").slice(0, 10).join("\n   ")}`);
  }
}
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);
const get = async (query) => {
  const res = await fetch(`${BASE}/files?${query}`);
  return { res, buf: Buffer.from(await res.arrayBuffer()) };
};
async function unzip(buf) {
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files);
  const files = {};
  for (const n of names) files[n] = Buffer.from(await zip.files[n].async("uint8array"));
  return { names, files };
}
// Colour of one pixel of an encoded image.
async function pixel(buf, x, y) {
  const { data } = await sharp(buf).extract({ left: Math.round(x), top: Math.round(y), width: 1, height: 1 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return [data[0], data[1], data[2]];
}
const near = (a, b, tol = 12) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
const size = async (buf) => {
  const m = await sharp(buf).metadata();
  return `${m.width}x${m.height} ${m.format}`;
};

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

async function partA() {
  console.log("\n### A. export pipeline -- real planPostExport + renderPostExport + sharp, measured");
  const F = {};
  for (const name of [
    "p/orig-a.png", "p/edit-a-preview.jpg", "p/orig-b.png", "p/orig-c.png", "p/edit-c-preview.jpg", "p/orig-v.mp4",
    "p/orig-w.mp4", "p/poster-v-edit.jpg", "p/poster-w-auto.jpg",
  ]) {
    F[name] = (await get(`fixture=${encodeURIComponent(name)}`)).buf;
  }
  console.log(
    `   fixtures: original a ${await size(F["p/orig-a.png"])}, saved edit of a ${await size(F["p/edit-a-preview.jpg"])}, original b ${await size(F["p/orig-b.png"])}, saved edit of c ${await size(F["p/edit-c-preview.jpg"])}`,
  );
  const CYAN = [0, 255, 255], MAGENTA = [255, 0, 255], WHITE = [255, 255, 255], BLACK = [0, 0, 0];
  const RED = [255, 0, 0], GREEN = [0, 255, 0], BLUE = [0, 0, 255], YELLOW = [255, 255, 0];

  const carousel = await unzip((await get("scenario=carousel")).buf);
  await check("carousel: 4 files in post order -- cover, slide-2, slide-3, slide-4 (video)", async () => {
    assert.deepEqual(carousel.names, ["cover.jpg", "slide-2.png", "slide-3.jpg", "slide-4.mp4"]);
  });
  await check("untouched slide is BYTE-IDENTICAL to the original upload (no re-encode, no resize)", async () => {
    assert.equal(sha(carousel.files["slide-2.png"]), sha(F["p/orig-b.png"]));
  });
  await check("edited slide is the SAVED EDIT, byte-for-byte (not the original, not re-encoded, not edited twice)", async () => {
    assert.equal(sha(carousel.files["slide-3.jpg"]), sha(F["p/edit-c-preview.jpg"]));
    assert.notEqual(sha(carousel.files["slide-3.jpg"]), sha(F["p/orig-c.png"]));
    assert.equal(await size(carousel.files["slide-3.jpg"]), "1200x1500 jpeg");
  });
  await check("video is the real file, byte-identical", async () => {
    assert.equal(sha(carousel.files["slide-4.mp4"]), sha(F["p/orig-v.mp4"]));
  });
  await check("edited + framed cover: measured 750x1000 -- zoom 2 of a 3:4 window on the 1600x2000 SAVED EDIT, native pixels, not upscaled", async () => {
    // Independent expectation: a 3:4 frame over a 4:5 (1600x2000) image is height-limited -> 1500x2000 window at zoom 1;
    // zoom 2 halves it -> 750x1000, centred (x 425..1175, y 500..1500).
    const m = await sharp(carousel.files["cover.jpg"]).metadata();
    assert.ok(Math.abs(m.width - 750) <= 1 && Math.abs(m.height - 1000) <= 1, `got ${m.width}x${m.height}`);
    assert.ok(m.width <= 1600 && m.height <= 2000, "never larger than its source");
  });
  await check("edited + framed cover: pixels are the saved edit's colours, centred on its quadrant corner -- none of the original's", async () => {
    const c = carousel.files["cover.jpg"];
    // The source's quadrant corner (800,1000) must land at the output centre (375,500).
    assert.ok(near(await pixel(c, 100, 100), CYAN), `top-left ${await pixel(c, 100, 100)}`);
    assert.ok(near(await pixel(c, 650, 100), MAGENTA), `top-right ${await pixel(c, 650, 100)}`);
    assert.ok(near(await pixel(c, 100, 900), WHITE), `bottom-left ${await pixel(c, 100, 900)}`);
    assert.ok(near(await pixel(c, 650, 900), BLACK), `bottom-right ${await pixel(c, 650, 900)}`);
    assert.ok(near(await pixel(c, 360, 485), CYAN) && near(await pixel(c, 390, 515), BLACK), "quadrant corner sits at the centre");
    for (const [x, y] of [[100, 100], [650, 100], [100, 900], [650, 900]]) {
      const p = await pixel(c, x, y);
      for (const orig of [RED, GREEN, BLUE, YELLOW]) assert.ok(!near(p, orig), `pixel ${p} is one of the ORIGINAL's colours`);
    }
  });

  const unframed = await unzip((await get("scenario=carousel-unframed")).buf);
  await check("edited cover with NO framing: the saved edit, byte-for-byte, full 1600x2000", async () => {
    assert.equal(sha(unframed.files["cover.jpg"]), sha(F["p/edit-a-preview.jpg"]));
    assert.equal(await size(unframed.files["cover.jpg"]), "1600x2000 jpeg");
  });

  const framedOrig = await unzip((await get("scenario=framed-original")).buf);
  await check("untouched cover + Grid framing (zoom 2, panned right 25%): measured 675x900 from the 2400x1800 original", async () => {
    // 3:4 frame over a 4:3 image is height-limited -> 1350x1800 at zoom 1 -> 675x900 at zoom 2.
    const m = await sharp(framedOrig.files["cover.jpg"]).metadata();
    assert.ok(Math.abs(m.width - 675) <= 1 && Math.abs(m.height - 900) <= 1, `got ${m.width}x${m.height}`);
  });
  await check("untouched cover + Grid framing: the crop shows exactly the columns the on-screen CSS model predicts", async () => {
    // On screen the image is scaled by 2 about the frame centre, then moved RIGHT by 0.25 x its fitted width.
    // In source pixels the visible window is therefore 675 wide and starts at 1200 - 337.5 - (0.25 * 2400) / 2 = 562.5.
    // Stripe i covers source x in [100i, 100i+100) and is rgb(10i, 255-10i, 128).
    const c = framedOrig.files["cover.jpg"];
    const stripeAt = async (outX) => Math.round((await pixel(c, outX, 450))[0] / 10);
    assert.equal(await stripeAt(18), 5, "left edge: source x ~580 -> stripe 5");
    assert.equal(await stripeAt(337), 9, "centre: source x ~900 -> stripe 9");
    assert.equal(await stripeAt(657), 12, "right edge: source x ~1220 -> stripe 12");
  });

  const framedA = await unzip((await get("scenario=framed-unedited-a")).buf);
  await check("unedited cover + framing starts from the ORIGINAL: 1500x2000 from 3000x4000, original colours", async () => {
    const c = framedA.files["cover.jpg"];
    const m = await sharp(c).metadata();
    assert.ok(Math.abs(m.width - 1500) <= 1 && Math.abs(m.height - 2000) <= 1, `got ${m.width}x${m.height}`);
    assert.ok(near(await pixel(c, 200, 200), RED) && near(await pixel(c, 1300, 200), GREEN));
    assert.ok(near(await pixel(c, 200, 1800), BLUE) && near(await pixel(c, 1300, 1800), YELLOW));
  });

  const originals = await unzip((await get("scenario=carousel&variant=original")).buf);
  await check("Download Originals: every file is the untouched upload, byte-identical -- no edit, no framing", async () => {
    assert.deepEqual(originals.names, ["cover.png", "slide-2.png", "slide-3.png", "slide-4.mp4"]);
    assert.equal(sha(originals.files["cover.png"]), sha(F["p/orig-a.png"]));
    assert.equal(sha(originals.files["slide-2.png"]), sha(F["p/orig-b.png"]));
    assert.equal(sha(originals.files["slide-3.png"]), sha(F["p/orig-c.png"]));
    assert.equal(sha(originals.files["slide-4.mp4"]), sha(F["p/orig-v.mp4"]));
    assert.equal(await size(originals.files["cover.png"]), "3000x4000 png");
  });

  await check("single-asset request returns ONE file (not a zip), identical to that item inside the zip", async () => {
    const cover = await get("scenario=carousel&asset=pa-a");
    assert.equal(cover.res.headers.get("content-type"), "image/jpeg");
    assert.equal(sha(cover.buf), sha(carousel.files["cover.jpg"]));
    const slide = await get("scenario=carousel&asset=pa-c");
    assert.equal(sha(slide.buf), sha(F["p/edit-c-preview.jpg"]));
    const orig = await get("scenario=carousel&asset=pa-a&variant=original");
    assert.equal(sha(orig.buf), sha(F["p/orig-a.png"]));
  });

  await check("a slide that can't be read fails the WHOLE export with a readable message -- no partial zip", async () => {
    const { res, buf } = await get("scenario=missing-slide");
    assert.equal(res.status, 502);
    assert.match(res.headers.get("content-type") ?? "", /json/);
    const body = JSON.parse(buf.toString("utf8"));
    assert.match(body.message, /slide 2/);
    assert.ok(!/does-not-exist|p\//.test(body.message), "no storage path in the message");
    assert.notEqual(buf.subarray(0, 2).toString("latin1"), "PK", "not a zip");
  });

  // --- video covers -------------------------------------------------------
  const ORANGE = [255, 128, 0], PURPLE = [128, 0, 255], TEAL = [0, 128, 128], PINK = [255, 105, 180], GREY = [119, 119, 119];
  const videoCovers = await unzip((await get("scenario=video-covers")).buf);
  await check("video with an EDITED cover: untouched video + its cover image next to it; automatic poster adds nothing", async () => {
    assert.deepEqual(videoCovers.names, ["cover.png", "slide-2.mp4", "slide-2-cover.jpg", "slide-3.mp4"]);
  });
  await check("both videos are the real files, byte-identical -- never modified by the cover image", async () => {
    assert.equal(sha(videoCovers.files["slide-2.mp4"]), sha(F["p/orig-v.mp4"]));
    assert.equal(sha(videoCovers.files["slide-3.mp4"]), sha(F["p/orig-w.mp4"]));
  });
  await check("an unframed edited video cover is the saved cover, byte-for-byte, full 1080x1440", async () => {
    assert.equal(sha(videoCovers.files["slide-2-cover.jpg"]), sha(F["p/poster-v-edit.jpg"]));
    assert.equal(await size(videoCovers.files["slide-2-cover.jpg"]), "1080x1440 jpeg");
  });

  const framedVideo = await unzip((await get("scenario=framed-video-edited")).buf);
  await check("FRAMED edited video cover: video untouched + cover-image.jpg, measured 540x720 (zoom 2 of the 3:4 1080x1440 cover)", async () => {
    assert.deepEqual(framedVideo.names, ["cover.mp4", "cover-image.jpg", "slide-2.png"]);
    assert.equal(sha(framedVideo.files["cover.mp4"]), sha(F["p/orig-v.mp4"]));
    // Independent expectation: a 3:4 frame over a 3:4 image is the whole image at zoom 1; zoom 2 halves it, centred.
    const m = await sharp(framedVideo.files["cover-image.jpg"]).metadata();
    assert.ok(Math.abs(m.width - 540) <= 1 && Math.abs(m.height - 720) <= 1, `got ${m.width}x${m.height}`);
  });
  await check("FRAMED edited video cover: pixels are the edited cover's quadrants, meeting at the centre", async () => {
    const c = framedVideo.files["cover-image.jpg"];
    assert.ok(near(await pixel(c, 100, 100), ORANGE), `top-left ${await pixel(c, 100, 100)}`);
    assert.ok(near(await pixel(c, 440, 100), PURPLE), `top-right ${await pixel(c, 440, 100)}`);
    assert.ok(near(await pixel(c, 100, 620), TEAL), `bottom-left ${await pixel(c, 100, 620)}`);
    assert.ok(near(await pixel(c, 440, 620), PINK), `bottom-right ${await pixel(c, 440, 620)}`);
  });

  const framedAuto = await unzip((await get("scenario=framed-video-auto")).buf);
  await check("FRAMED video cover WITHOUT an Edit Cover: the automatic poster with the framing, measured 360x480", async () => {
    assert.deepEqual(framedAuto.names, ["cover.mp4", "cover-image.jpg"]);
    assert.equal(sha(framedAuto.files["cover.mp4"]), sha(F["p/orig-w.mp4"]));
    // 3:4 frame over a 9:16 (720x1280) image is width-limited -> 720x960 at zoom 1 -> 360x480 at zoom 2.
    const c = framedAuto.files["cover-image.jpg"];
    const m = await sharp(c).metadata();
    assert.ok(Math.abs(m.width - 360) <= 1 && Math.abs(m.height - 480) <= 1, `got ${m.width}x${m.height}`);
    assert.ok(near(await pixel(c, 180, 240), GREY), `centre ${await pixel(c, 180, 240)}`);
  });

  const rotated = await unzip((await get("scenario=framed-video-rotated")).buf);
  await check("framing WITH a 90-degree rotation: measured 810x1080, quadrants turned clockwise", async () => {
    // Independent expectation: turned 90 degrees clockwise (CSS rotate(90deg)), the 1080x1440 cover is 1440x1080;
    // filling a 3:4 frame needs zoom 4/3, so the window is 810x1080 of it, centred.
    // Clockwise: old bottom-left (teal) -> top-left, old top-left (orange) -> top-right,
    // old bottom-right (pink) -> bottom-left, old top-right (purple) -> bottom-right.
    const c = rotated.files["cover-image.jpg"];
    const m = await sharp(c).metadata();
    assert.ok(Math.abs(m.width - 810) <= 1 && Math.abs(m.height - 1080) <= 1, `got ${m.width}x${m.height}`);
    assert.ok(near(await pixel(c, 100, 100), TEAL), `top-left ${await pixel(c, 100, 100)}`);
    assert.ok(near(await pixel(c, 710, 100), ORANGE), `top-right ${await pixel(c, 710, 100)}`);
    assert.ok(near(await pixel(c, 100, 980), PINK), `bottom-left ${await pixel(c, 100, 980)}`);
    assert.ok(near(await pixel(c, 710, 980), PURPLE), `bottom-right ${await pixel(c, 710, 980)}`);
  });

  await check("single requests: part=cover-image returns just the cover image; no part returns the video", async () => {
    const cover = await get("scenario=framed-video-edited&asset=pa-ve&part=cover-image");
    assert.equal(cover.res.headers.get("content-type"), "image/jpeg");
    assert.equal(sha(cover.buf), sha(framedVideo.files["cover-image.jpg"]));
    const video = await get("scenario=framed-video-edited&asset=pa-ve");
    assert.equal(video.res.headers.get("content-type"), "video/mp4");
    assert.equal(sha(video.buf), sha(F["p/orig-v.mp4"]));
    const none = await get("scenario=video-covers&asset=pa-va&part=cover-image");
    assert.equal(none.res.status, 404, "an automatic, unframed poster is not offered");
  });

  await check("Download Originals with video covers: only the untouched files -- no cover images", async () => {
    const o = await unzip((await get("scenario=video-covers&variant=original")).buf);
    assert.deepEqual(o.names, ["cover.png", "slide-2.mp4", "slide-3.mp4"]);
    assert.equal(sha(o.files["slide-2.mp4"]), sha(F["p/orig-v.mp4"]));
    assert.equal(sha(o.files["slide-3.mp4"]), sha(F["p/orig-w.mp4"]));
  });

  await check("exporting is read-only: every fixture is byte-identical after all of the above", async () => {
    for (const [name, before] of Object.entries(F)) {
      assert.equal(sha((await get(`fixture=${encodeURIComponent(name)}`)).buf), sha(before), name);
    }
  });
}

async function partB(browser) {
  console.log("\n### B. saved-edit resolution -- the real annotation save path (Chromium), measured");
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const sources = {
    "big.png": await sharp({ create: { width: 3000, height: 4000, channels: 3, background: "#3366cc" } }).png().toBuffer(),
    "wide.png": await sharp({ create: { width: 4000, height: 3000, channels: 3, background: "#33cc66" } }).png().toBuffer(),
    "small.png": await sharp({ create: { width: 800, height: 1000, channels: 3, background: "#cc6633" } }).png().toBuffer(),
  };
  await page.route("https://media.test/**", (r) => {
    const buf = sources[new URL(r.request().url()).pathname.slice(1)];
    return buf ? r.fulfill({ body: buf, contentType: "image/png", headers: { "access-control-allow-origin": "*" } }) : r.fulfill({ status: 404 });
  });
  await page.goto(`${BASE}/editor`, { waitUntil: "load" });
  await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 90000 });
  const measure = (file, aspect) => page.evaluate(([f, a]) => window.__measureSavedEdit("https://media.test/" + f, a), [file, aspect]);

  const results = {};
  for (const [label, file, aspect] of [
    ["3000x4000 source as a 3:4 cover", "big.png", { w: 3, h: 4 }],
    ["3000x4000 source as a 4:5 slide", "big.png", { w: 4, h: 5 }],
    ["4000x3000 source as a 4:5 slide", "wide.png", { w: 4, h: 5 }],
    ["800x1000 source as a 4:5 slide", "small.png", { w: 4, h: 5 }],
  ]) {
    const r = await measure(file, aspect);
    results[label] = r;
    console.log(`   measured: ${label} -> saved edit ${r.out?.w}x${r.out?.h} ${r.out?.type}, ${(r.out?.bytes / 1024).toFixed(0)} KB (editor canvas ${Math.round(r.frame.canvasW)}x${Math.round(r.frame.canvasH)})`);
  }
  await check("a 3000x4000 photo edited as a 3:4 cover is saved at its full native 3000x4000", async () => {
    const o = results["3000x4000 source as a 3:4 cover"].out;
    assert.ok(Math.abs(o.w - 3000) <= 2 && Math.abs(o.h - 4000) <= 2, `${o.w}x${o.h}`);
  });
  await check("a 3000x4000 photo edited as a 4:5 slide is saved at native pixels of its 4:5 crop (3000x3750)", async () => {
    const o = results["3000x4000 source as a 4:5 slide"].out;
    assert.ok(Math.abs(o.w - 3000) <= 2 && Math.abs(o.h - 3750) <= 2, `${o.w}x${o.h}`);
  });
  await check("a 4000x3000 photo edited as a 4:5 slide is saved at native pixels of its 4:5 crop (2400x3000)", async () => {
    const o = results["4000x3000 source as a 4:5 slide"].out;
    assert.ok(Math.abs(o.w - 2400) <= 2 && Math.abs(o.h - 3000) <= 2, `${o.w}x${o.h}`);
  });
  await check("a saved edit is never smaller than the 1080px publishing floor (an 800x1000 photo is saved at 1080x1350)", async () => {
    const o = results["800x1000 source as a 4:5 slide"].out;
    assert.ok(Math.abs(o.w - 1080) <= 2 && Math.abs(o.h - 1350) <= 2, `${o.w}x${o.h}`);
  });
  await ctx.close();
}

async function partC(engine, browser, video) {
  console.log(`\n### C. Post Editor UI -- ${engine} ${browser.version()}${engine === "webkit" ? " (Playwright build -- not Safari on macOS)" : ""}`);
  const tinyZip = await new JSZip().file("cover.jpg", "x").generateAsync({ type: "nodebuffer" });
  const img = async (color) => sharp({ create: { width: 300, height: 400, channels: 3, background: color } }).jpeg().toBuffer();
  const MEDIA = {
    "edit-1-preview.jpg": await img("#00ffff"),
    "orig-1.png": await img("#ff0000"),
    "orig-2.png": await img("#00ff00"),
    "edit-3-preview.jpg": await img("#ff00ff"),
    "orig-3.png": await img("#0000ff"),
    "poster-4.jpg": await img("#888888"),
    "video-4.webm": video,
    "poster-5-edit.jpg": await img("#ff8000"),
    "video-5.webm": video,
  };
  async function open({ mobile = false, query = "", exportFails = false } = {}) {
    const ctx = await browser.newContext({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1400, height: 900 },
      hasTouch: mobile,
      isMobile: mobile,
      acceptDownloads: true,
    });
    const page = await ctx.newPage();
    if (mobile) {
      await page.addInitScript(() => {
        window.__shares = [];
        navigator.canShare = () => true;
        navigator.share = async ({ files }) => void window.__shares.push(files.map((f) => ({ name: f.name, type: f.type, size: f.size })));
      });
    }
    const requests = [];
    await page.route("https://media.test/**", (r) => {
      const file = new URL(r.request().url()).pathname.slice(1);
      // The tiles' own <img>/<video> loads are not downloads -- only fetch() is.
      if (r.request().resourceType() === "fetch") requests.push(file);
      const body = MEDIA[file];
      return body ? r.fulfill({ body, contentType: file.endsWith(".webm") ? "video/webm" : "image/jpeg", headers: { "access-control-allow-origin": "*" } }) : r.fulfill({ status: 404 });
    });
    await page.route(`**${EXPORT_PATH}**`, (r) => {
      const u = new URL(r.request().url());
      requests.push("export" + u.search);
      if (exportFails) return r.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ message: "Couldn't prepare slide 3 for download, so nothing was downloaded." }) });
      if (u.searchParams.get("asset")) return r.fulfill({ body: MEDIA["edit-1-preview.jpg"], contentType: "image/jpeg" });
      return r.fulfill({ body: tinyZip, contentType: "application/zip" });
    });
    // Next runs server actions one at a time; the comments thread's own
    // mount-time action must not hang, and nothing may reach the server.
    await page.route(`http://localhost:${PORT}/**`, (r) => (r.request().method() === "POST" && r.request().headers()["next-action"] ? r.abort() : r.fallback()));
    await page.goto(`${BASE}/ui${query}`, { waitUntil: "load" });
    const actions = page.locator("[data-post-download-actions]");
    await actions.waitFor({ timeout: 90000 });
    const menuButton = page.locator("button[title='Frame options']");
    // Hydrated once a frame menu actually opens on click.
    for (const end = Date.now() + 90000; ; ) {
      await menuButton.first().click();
      if (await page.getByRole("button", { name: "Replace" }).count()) break;
      if (Date.now() > end) throw new Error("page never hydrated");
      await page.waitForTimeout(250);
    }
    await menuButton.first().click();
    const frameMenu = async (index, item) => {
      await menuButton.nth(index).click();
      await page.getByRole("button", { name: item, exact: true }).click();
    };
    return { ctx, page, requests, actions, frameMenu };
  }
  const menuButton = (page) => page.locator("button[title='Frame options']");
  const downloadOf = async (page, act) => {
    const [d] = await Promise.all([page.waitForEvent("download", { timeout: 8000 }), act()]);
    return d.suggestedFilename();
  };

  {
    const { ctx, page, requests, actions, frameMenu } = await open();
    await check(`${engine} desktop: both actions are present and separately named`, async () => {
      assert.equal(await actions.getByRole("button", { name: "Download Media", exact: true }).count(), 1);
      assert.equal(await actions.getByRole("button", { name: "Download Originals", exact: true }).count(), 1);
    });
    await check(`${engine} desktop: Download Media -> the EDITED export (no variant), saved as ...-export.zip`, async () => {
      requests.length = 0;
      const name = await downloadOf(page, () => actions.getByRole("button", { name: "Download Media", exact: true }).click());
      assert.deepEqual(requests, ["export"]);
      assert.equal(name, `post-${POST}-export.zip`);
    });
    await check(`${engine} desktop: Download Originals -> variant=original, saved as ...-originals.zip`, async () => {
      requests.length = 0;
      const name = await downloadOf(page, () => actions.getByRole("button", { name: "Download Originals", exact: true }).click());
      assert.deepEqual(requests, ["export?variant=original"]);
      assert.equal(name, `post-${POST}-originals.zip`);
    });
    await check(`${engine} desktop: per-frame Download on an EDITED slide fetches the saved edit, not the original`, async () => {
      requests.length = 0;
      const name = await downloadOf(page, () => frameMenu(2, "Download"));
      assert.deepEqual(requests, ["edit-3-preview.jpg"]);
      assert.equal(name, "edit-3-preview.jpg");
    });
    await check(`${engine} desktop: per-frame Download Original fetches the original upload`, async () => {
      requests.length = 0;
      const name = await downloadOf(page, () => frameMenu(2, "Download Original"));
      assert.deepEqual(requests, ["orig-3.png"]);
      assert.equal(name, "orig-3.png");
    });
    await check(`${engine} desktop: per-frame Download on the FRAMED cover is rendered by the export route (single asset)`, async () => {
      requests.length = 0;
      const name = await downloadOf(page, () => frameMenu(0, "Download"));
      assert.deepEqual(requests, ["export?asset=pa-1"]);
      assert.equal(name, "cover.jpg");
    });
    await check(`${engine} desktop: per-frame Download on a video is the real video file`, async () => {
      requests.length = 0;
      const name = await downloadOf(page, () => frameMenu(3, "Download"));
      assert.deepEqual(requests, ["video-4.webm"]);
      assert.equal(name, "video-4.webm");
    });
    await check(`${engine} desktop: per-frame Download Cover Image on a video with an EDITED cover fetches that cover image`, async () => {
      requests.length = 0;
      const name = await downloadOf(page, () => frameMenu(4, "Download Cover Image"));
      assert.deepEqual(requests, ["poster-5-edit.jpg"]);
      assert.equal(name, "poster-5-edit.jpg");
    });
    await check(`${engine} desktop: per-frame Download on that video is still the real video file`, async () => {
      requests.length = 0;
      const name = await downloadOf(page, () => frameMenu(4, "Download"));
      assert.deepEqual(requests, ["video-5.webm"]);
      assert.equal(name, "video-5.webm");
    });
    await check(`${engine} desktop: no Download Cover Image on images or on a video with only its automatic poster`, async () => {
      for (const index of [1, 2, 3]) {
        await menuButton(page).nth(index).click();
        await page.getByRole("button", { name: "Download Original", exact: true }).waitFor({ timeout: 5000 });
        assert.equal(await page.getByRole("button", { name: "Download Cover Image", exact: true }).count(), 0, `frame ${index}`);
        await menuButton(page).nth(index).click();
      }
    });
    await ctx.close();
  }
  {
    const { ctx, page, requests, frameMenu } = await open({ query: "?order=video-first" });
    await check(`${engine} desktop: a video as the FRAMED post cover offers its cover image, rendered by the export route`, async () => {
      requests.length = 0;
      const name = await downloadOf(page, () => frameMenu(0, "Download Cover Image"));
      assert.deepEqual(requests, ["export?asset=pa-4&part=cover-image"]);
      assert.equal(name, "cover-image.jpg");
    });
    await ctx.close();
  }
  {
    const { ctx, page, requests, frameMenu } = await open({ query: "?framing=off" });
    await check(`${engine} desktop: an edited cover WITHOUT framing downloads its saved edit directly (no server render)`, async () => {
      requests.length = 0;
      const name = await downloadOf(page, () => frameMenu(0, "Download"));
      assert.deepEqual(requests, ["edit-1-preview.jpg"]);
      assert.equal(name, "edit-1-preview.jpg");
    });
    await ctx.close();
  }
  {
    const { ctx, page, requests, actions } = await open({ exportFails: true });
    await check(`${engine} desktop: a failed export shows the server's message and downloads nothing`, async () => {
      let downloads = 0;
      page.on("download", () => downloads++);
      await actions.getByRole("button", { name: "Download Media", exact: true }).click();
      await page.getByText("Couldn't prepare slide 3 for download, so nothing was downloaded.").waitFor({ timeout: 5000 });
      await page.waitForTimeout(400);
      assert.equal(downloads, 0);
      assert.deepEqual(requests.filter((r) => r.startsWith("export")), ["export"]);
      assert.equal(await actions.getByRole("button", { name: "Download Media", exact: true }).isDisabled(), false);
    });
    await ctx.close();
  }
  {
    const { ctx, page, requests, actions } = await open({ mobile: true });
    await check(`${engine} touch: Save Media shares the EDITED files individually -- framed cover via the route, edits from storage, no zip`, async () => {
      assert.equal(await actions.getByRole("button", { name: "Save Media", exact: true }).count(), 1);
      assert.equal(await actions.getByRole("button", { name: "Save Originals", exact: true }).count(), 1);
      requests.length = 0;
      await actions.getByRole("button", { name: "Save Media", exact: true }).tap();
      await page.waitForFunction(() => window.__shares.length === 1, null, { timeout: 8000 });
      const shared = await page.evaluate(() => window.__shares[0]);
      // the edited video cover rides along right after its video; the automatic poster does not
      assert.deepEqual(shared.map((f) => f.name), ["cover.jpg", "orig-2.png", "edit-3-preview.jpg", "video-4.webm", "video-5.webm", "poster-5-edit.jpg"]);
      assert.deepEqual([...requests].sort(), ["edit-3-preview.jpg", "export?asset=pa-1", "orig-2.png", "poster-5-edit.jpg", "video-4.webm", "video-5.webm"]);
      assert.ok(shared.every((f) => f.size > 0 && /^(image|video)\//.test(f.type)), JSON.stringify(shared));
    });
    await check(`${engine} touch: Save Originals shares the original uploads`, async () => {
      requests.length = 0;
      await actions.getByRole("button", { name: "Save Originals", exact: true }).tap();
      await page.waitForFunction(() => window.__shares.length === 2, null, { timeout: 8000 });
      const shared = await page.evaluate(() => window.__shares[1]);
      assert.deepEqual(shared.map((f) => f.name), ["orig-1.png", "orig-2.png", "orig-3.png", "video-4.webm", "video-5.webm"]);
      assert.ok(!requests.some((r) => r.startsWith("export") || r.includes("preview") || r.includes("poster")), String(requests));
    });
    await ctx.close();
  }
  {
    const { ctx, page, requests, actions } = await open({ mobile: true, query: "?order=video-first" });
    await check(`${engine} touch: a FRAMED video cover is shared as the video plus its route-rendered cover image`, async () => {
      requests.length = 0;
      await actions.getByRole("button", { name: "Save Media", exact: true }).tap();
      await page.waitForFunction(() => window.__shares.length === 1, null, { timeout: 8000 });
      const shared = await page.evaluate(() => window.__shares[0]);
      assert.deepEqual(shared.map((f) => f.name).slice(0, 2), ["video-4.webm", "cover-image.jpg"]);
      assert.ok(requests.includes("export?asset=pa-4&part=cover-image"), String(requests));
    });
    await ctx.close();
  }
  {
    const { ctx, page, actions } = await open({ mobile: true, exportFails: true });
    await check(`${engine} touch: if the cover can't be rendered, NOTHING is shared (never an error body posing as an image) and the error is shown`, async () => {
      await actions.getByRole("button", { name: "Save Media", exact: true }).tap();
      await page.getByText("Couldn't prepare slide 3 for download, so nothing was downloaded.").waitFor({ timeout: 8000 });
      assert.equal(await page.evaluate(() => window.__shares.length), 0);
    });
    await ctx.close();
  }
}

async function recordTestVideo(browser) {
  const page = await browser.newPage();
  const b64 = await page.evaluate(async () => {
    const c = Object.assign(document.createElement("canvas"), { width: 180, height: 240 });
    const ctx = c.getContext("2d");
    const rec = new MediaRecorder(c.captureStream(30), { mimeType: "video/webm" });
    const chunks = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.start();
    const t0 = performance.now();
    await new Promise((done) => {
      (function frame() {
        const t = performance.now() - t0;
        ctx.fillStyle = `hsl(${(t / 10) % 360} 60% 45%)`;
        ctx.fillRect(0, 0, 180, 240);
        if (t < 800) requestAnimationFrame(frame);
        else done();
      })();
    });
    rec.stop();
    await new Promise((r) => (rec.onstop = r));
    const buf = await new Blob(chunks, { type: "video/webm" }).arrayBuffer();
    let s = "";
    for (const byte of new Uint8Array(buf)) s += String.fromCharCode(byte);
    return btoa(s);
  });
  await page.close();
  return Buffer.from(b64, "base64");
}

if (fs.existsSync(HARNESS_DIR)) {
  console.error(`Refusing to run: ${HARNESS_DIR} already exists.`);
  process.exit(1);
}
let server;
const browsers = [];
try {
  for (const [dir, file, source] of [
    ["files", "route.ts", ROUTE],
    ["editor", "page.tsx", EDITOR_PAGE],
    ["ui", "page.tsx", UI_PAGE],
  ]) {
    fs.mkdirSync(path.join(HARNESS_DIR, dir), { recursive: true });
    fs.writeFileSync(path.join(HARNESS_DIR, dir, file), source);
  }
  server = spawn(`npx next dev --port ${PORT}`, { cwd: ROOT, shell: true, stdio: "ignore" });
  await waitForServer(`${BASE}/editor`, 180000);
  await partA();
  const cr = await chromium.launch();
  browsers.push(cr);
  await partB(cr);
  const video = await recordTestVideo(cr);
  await partC("chromium", cr, video);
  const wk = await webkit.launch();
  browsers.push(wk);
  await partC("webkit", wk, video);
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
  // next dev registers every route it compiled in generated type stubs
  // (.next/dev/types, included by tsconfig). Left alone, they'd keep
  // referencing the deleted harness files and break `tsc`/`next build`.
  fs.rmSync(path.join(ROOT, ".next", "dev", "types"), { recursive: true, force: true });
}
console.log(`\n${passed} checks passed, ${failed} failed`);
if (failed) process.exit(1);
