// Opt-in REAL-BROWSER measurement for the Post Editor popup's large viewer:
// does it show each item at the post's aspect ratio and framing -- the same
// thing the tile and the download show -- and at what effective resolution?
//
//   node scripts/post-editor-viewer-aspect.check.mjs
//
// Same approach as scripts/post-editor-media-viewer.check.mjs: the REAL Modal
// + PostEditor + Lightbox on fixture data, through a TEMPORARY page under a
// proxy-public path that is always deleted afterwards. Media is generated
// here with sharp and served by request interception. Read-only.
//
// Oracle (independent of the app's renderer): sharp resizes the SOURCE file
// to the viewer box's device-pixel size -- the whole image for "Original",
// a centred cover crop for a fixed ratio with no saved framing (what the
// export route renders for that case). The viewer box is screenshotted at
// DPR 2 and compared pixel by pixel. Effective resolution is measured from
// the rendered <img>'s on-screen size (transform included) against the
// source's natural width: source px per device px, < 1 = upscaled.

import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HARNESS_DIR = path.join(ROOT, "src", "app", "preview-viewer-aspect-check");
const PORT = 3125;
const BASE = `http://localhost:${PORT}/preview-viewer-aspect-check`;
const DPR = 2;

const HARNESS = `"use client";
// TEMPORARY -- created and deleted by scripts/post-editor-viewer-aspect.check.mjs. Never commit.
import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Modal } from "../projects/[projectId]/modal";
import { PostEditor, type PostAssetItem } from "../projects/[projectId]/posts/[postId]/post-editor";
const a = (id: string, url: string, mediaType: "image" | "video", posterUrl: string | null = null): PostAssetItem =>
  ({ postAssetId: "pa-" + id, mediaAssetId: "m-" + id, url, originalUrl: url, annotationJson: null, mediaType, posterUrl, frameTransform: null });
const LIBRARY = Promise.resolve({ entries: [], nextCursor: null, hasMore: false });
const GRID_CROP = { scale: 1.4, x: 0.05, y: 0, rotation: 0, scope: "grid-preview", scopeVersion: 1 };
export default function Harness() {
  const params = useSearchParams();
  const aspect = params.get("aspect");
  const cover = params.get("cover") ?? "land";
  const assets = useMemo(() => [
    a("1", "https://media.test/" + cover + ".jpg", "image"),
    a("2", "https://media.test/port.jpg", "image"),
    a("3", "https://media.test/video.webm", "video", "https://media.test/poster.jpg"),
  ], [cover]);
  const post = useMemo(() => ({ id: "00000000-0000-0000-0000-000000000001", post_type: "carousel", caption: "", notes: "", scheduled_date: null, scheduled_time: null, status: "draft", review_status: "pending", coverTransform: GRID_CROP, aspectRatio: aspect === "none" ? null : aspect }) as const, [aspect]);
  return (
    <Modal onClose={() => {}}>
      <PostEditor projectId="00000000-0000-0000-0000-000000000000" post={post as never} assets={assets} links={[]} mediaLibraryPromise={LIBRARY}
        canManage role="owner" currentUserId="00000000-0000-0000-0000-000000000002" members={[]} dateFormat="DD/MM/YYYY" hideBackLink enableMediaViewer />
    </Modal>
  );
}
`;

// A detailed, position-dependent test image: four coloured quadrants, a
// 1/10 grid and corner labels -- any crop, shift or blur shows in the diff.
async function testImage(w, h) {
  const lines = [];
  for (let i = 1; i < 10; i++) {
    lines.push(`<line x1="${(w * i) / 10}" y1="0" x2="${(w * i) / 10}" y2="${h}" stroke="white" stroke-width="${Math.max(2, w / 600)}"/>`);
    lines.push(`<line x1="0" y1="${(h * i) / 10}" x2="${w}" y2="${(h * i) / 10}" stroke="white" stroke-width="${Math.max(2, w / 600)}"/>`);
  }
  const fs_ = Math.min(w, h) / 8;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect width="${w / 2}" height="${h / 2}" fill="#c0392b"/><rect x="${w / 2}" width="${w / 2}" height="${h / 2}" fill="#2471a3"/>
    <rect y="${h / 2}" width="${w / 2}" height="${h / 2}" fill="#1e8449"/><rect x="${w / 2}" y="${h / 2}" width="${w / 2}" height="${h / 2}" fill="#d4ac0d"/>
    ${lines.join("")}
    <text x="${fs_ * 0.3}" y="${fs_}" font-size="${fs_}" fill="white" font-family="sans-serif">TL</text>
    <text x="${w - fs_ * 1.6}" y="${h - fs_ * 0.3}" font-size="${fs_}" fill="white" font-family="sans-serif">BR</text>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 95 }).toBuffer();
}

let passed = 0;
let failed = 0;
const findings = [];
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL - ${name}\n   ${String(e.message).split("\n").slice(0, 6).join("\n   ")}`);
  }
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

async function run(browser) {
  const SOURCES = {
    "land.jpg": [3000, 2000],
    "small.jpg": [1080, 1350],
    "port.jpg": [1500, 2000],
    "poster.jpg": [1080, 1920],
  };
  const MEDIA = {};
  for (const [name, [w, h]] of Object.entries(SOURCES)) MEDIA[name] = [await testImage(w, h), "image/jpeg"];
  MEDIA["video.webm"] = [Buffer.alloc(0), "video/webm"];

  async function openViewer(query, tileIndex, viewport) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: DPR });
    const page = await ctx.newPage();
    await page.route("https://media.test/**", (r) => {
      const m = MEDIA[new URL(r.request().url()).pathname.slice(1)];
      return m ? r.fulfill({ body: m[0], contentType: m[1] }) : r.fulfill({ status: 404 });
    });
    await page.goto(BASE + query, { waitUntil: "networkidle" });
    await page.waitForSelector("text=Close X", { timeout: 90000 });
    await page.waitForTimeout(800);
    await page.locator("[data-post-media-preview]").nth(tileIndex).click();
    await page.waitForSelector("[data-post-media-viewer]", { state: "attached", timeout: 8000 });
    // past the entrance fade and the measured-transform render
    await page.waitForTimeout(900);
    return { ctx, page };
  }

  // The viewer's box, the image's on-screen rect (transform included), and
  // the tile's own box for comparison.
  const measure = (page, tileIndex) =>
    page.evaluate((ti) => {
      const root = document.querySelector("[data-post-media-viewer]");
      const box = root.querySelector("div.animate-settle-in");
      const img = [...box.querySelectorAll("img")].pop();
      const b = box.getBoundingClientRect();
      const i = img.getBoundingClientRect();
      const tile = document.querySelectorAll("[data-post-media-preview]")[ti].getBoundingClientRect();
      return {
        box: { x: b.x, y: b.y, w: b.width, h: b.height },
        img: { x: i.x, y: i.y, w: i.width, h: i.height },
        natural: { w: img.naturalWidth, h: img.naturalHeight },
        src: img.getAttribute("src"),
        tileAspect: tile.width / tile.height,
      };
    }, tileIndex);

  async function diffAgainst(page, m, oracle) {
    const clip = { x: Math.ceil(m.box.x), y: Math.ceil(m.box.y), width: Math.floor(m.box.w) - 1, height: Math.floor(m.box.h) - 1 };
    const shot = await page.screenshot({ clip });
    const { data, info } = await sharp(shot).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const expected = await oracle(info.width, info.height);
    const { data: e } = await sharp(expected).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let s = 0;
    for (let k = 0; k < data.length; k++) s += Math.abs(data[k] - e[k]);
    return { meanDiff: s / data.length, devicePx: [info.width, info.height] };
  }

  const viewport = { width: 1400, height: 900 };
  const cases = [
    {
      name: "Original, landscape 3000x2000 cover",
      query: "?aspect=original&cover=land",
      tile: 0,
      source: "land.jpg",
      expectAspect: 1.5,
      // the WHOLE image
      oracle: (w, h) => sharp(MEDIA["land.jpg"][0]).resize(w, h, { fit: "fill" }).png().toBuffer(),
      fullImage: true,
    },
    {
      name: "Original, 1080x1350 (typical IG 4:5) cover",
      query: "?aspect=original&cover=small",
      tile: 0,
      source: "small.jpg",
      expectAspect: 0.8,
      oracle: (w, h) => sharp(MEDIA["small.jpg"][0]).resize(w, h, { fit: "fill" }).png().toBuffer(),
      fullImage: true,
    },
    {
      name: "Original, portrait carousel slide at the cover's 3:2 ratio",
      query: "?aspect=original&cover=land",
      tile: 1,
      source: "port.jpg",
      expectAspect: 1.5,
      oracle: (w, h) => sharp(MEDIA["port.jpg"][0]).resize(w, h, { fit: "cover", position: "centre" }).png().toBuffer(),
    },
    {
      name: "4:5, landscape cover, no saved framing (centred)",
      query: "?aspect=4:5&cover=land",
      tile: 0,
      source: "land.jpg",
      expectAspect: 0.8,
      oracle: (w, h) => sharp(MEDIA["land.jpg"][0]).resize(w, h, { fit: "cover", position: "centre" }).png().toBuffer(),
    },
    {
      name: "4:5, portrait carousel slide (centred)",
      query: "?aspect=4:5&cover=land",
      tile: 1,
      source: "port.jpg",
      expectAspect: 0.8,
      oracle: (w, h) => sharp(MEDIA["port.jpg"][0]).resize(w, h, { fit: "cover", position: "centre" }).png().toBuffer(),
    },
    {
      name: "legacy post (no ratio stored): unchanged 3:4 box",
      query: "?aspect=none&cover=land",
      tile: 0,
      source: "land.jpg",
      expectAspect: 0.75,
      legacy: true,
    },
    {
      name: "4:5, carousel VIDEO: box at the post ratio, poster shown",
      query: "?aspect=4:5&cover=land",
      tile: 2,
      source: "poster.jpg",
      expectAspect: 0.8,
      video: true,
    },
  ];

  for (const c of cases) {
    const { ctx, page } = await openViewer(c.query, c.tile, viewport);
    const m = await measure(page, c.tile);
    const boxAspect = m.box.w / m.box.h;
    const srcPerDevicePx = m.natural.w / (m.img.w * DPR);
    const shownW = Math.min(1, m.box.w / m.img.w);
    const shownH = Math.min(1, m.box.h / m.img.h);
    let diff = null;
    if (c.oracle) diff = await diffAgainst(page, m, c.oracle);
    findings.push({
      case: c.name,
      source: `${m.natural.w}x${m.natural.h}`,
      viewerBoxCss: `${m.box.w.toFixed(0)}x${m.box.h.toFixed(0)} (${boxAspect.toFixed(3)})`,
      tileAspect: m.tileAspect.toFixed(3),
      imgOnScreenCss: `${m.img.w.toFixed(0)}x${m.img.h.toFixed(0)}`,
      shownOfSource: `${(shownW * 100).toFixed(0)}% x ${(shownH * 100).toFixed(0)}%`,
      srcPxPerDevicePx: srcPerDevicePx.toFixed(2),
      meanDiffVsOracle: diff ? diff.meanDiff.toFixed(2) : "-",
    });
    await check(`${c.name}: viewer box is ${c.expectAspect} and matches the tile's shape`, async () => {
      assert.ok(Math.abs(boxAspect / c.expectAspect - 1) < 0.01, `box aspect ${boxAspect}`);
      if (!c.legacy) assert.ok(Math.abs(boxAspect / m.tileAspect - 1) < 0.02, `tile aspect ${m.tileAspect}`);
      assert.ok(m.box.x >= 0 && m.box.y >= 0 && m.box.x + m.box.w <= viewport.width && m.box.y + m.box.h <= viewport.height, "inside the viewport");
    });
    if (c.fullImage) {
      await check(`${c.name}: the WHOLE image is shown (img rect == box)`, async () => {
        for (const k of ["x", "y", "w", "h"]) assert.ok(Math.abs(m.img[k] - m.box[k]) < 1.5, `img ${JSON.stringify(m.img)} vs box ${JSON.stringify(m.box)}`);
      });
    }
    if (diff) {
      await check(`${c.name}: pixels match the source oracle (mean diff ${diff.meanDiff.toFixed(2)} / 255)`, async () => {
        assert.ok(diff.meanDiff < 6, `mean diff ${diff.meanDiff}`);
      });
    }
    if (c.video) {
      await check(`${c.name}: shows the poster`, async () => {
        assert.match(m.src, /poster\.jpg$/);
      });
    }
    await ctx.close();
  }
}

if (fs.existsSync(HARNESS_DIR)) {
  console.error(`Refusing to run: ${HARNESS_DIR} already exists.`);
  process.exit(1);
}
let server;
let browser;
try {
  fs.mkdirSync(HARNESS_DIR, { recursive: true });
  fs.writeFileSync(path.join(HARNESS_DIR, "page.tsx"), HARNESS);
  server = spawn(`npx next dev --port ${PORT}`, { cwd: ROOT, shell: true, stdio: "ignore" });
  await waitForServer(BASE, 180000);
  browser = await chromium.launch({ channel: "msedge" }).catch(() => chromium.launch({ channel: "chrome" }));
  await run(browser);
} finally {
  await browser?.close().catch(() => {});
  if (server?.pid) {
    try {
      if (process.platform === "win32") execSync(`taskkill /pid ${server.pid} /T /F`, { stdio: "ignore" });
      else process.kill(-server.pid);
    } catch {
      // already gone
    }
  }
  fs.rmSync(HARNESS_DIR, { recursive: true, force: true });
  // see post-editor-media-viewer.check.mjs: stale route type stubs break tsc
  fs.rmSync(path.join(ROOT, ".next", "dev", "types"), { recursive: true, force: true });
}
console.table(findings);
console.log(`\n${passed} checks passed, ${failed} failed`);
if (failed) process.exit(1);
