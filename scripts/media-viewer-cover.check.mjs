// Opt-in browser check for the cover-first video viewer (D4) in the shared
// gallery components (components/media-gallery.tsx: MediaFrame + Lightbox),
// rendered through the REAL client preview / Review Content gallery
// (app/preview/[token]/shared-gallery.tsx) on fixtures. Not part of the
// default test run: it starts a Next dev server and needs Playwright's
// Chromium and WebKit.
//
//   node scripts/media-viewer-cover.check.mjs
//
// The Post Editor viewer (the same Lightbox) is covered by
// scripts/post-editor-media-viewer.check.mjs. No database, no storage; the
// review controls are rendered but never used. Playwright's WebKit is not
// Safari, and its emulated touch is not a real phone.

import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { chromium, webkit } from "playwright";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HARNESS_DIR = path.join(ROOT, "src", "app", "preview-viewer-cover-harness-check");
const PORT = 3129;
const BASE = `http://localhost:${PORT}/preview-viewer-cover-harness-check`;
const M = "https://media.test/";

const HARNESS = `"use client";
// TEMPORARY -- created and deleted by scripts/media-viewer-cover.check.mjs. Never commit.
import { SharedGallery } from "../preview/[token]/shared-gallery";
import type { SharedGalleryItem } from "@/lib/data/share-preview";
const base = { caption: "", notes: "", reviewStatus: "pending" as const, storyId: null };
const ITEMS: SharedGalleryItem[] = [
  // a Reel whose cover was saved through Edit Cover, with a Grid framing (zoom 2), landscape video
  { ...base, id: "i-a", type: "post", postId: "p-a", coverTransform: { scale: 2, x: 0, y: 0, rotation: 0 },
    media: [{ mediaAssetId: "m-a", url: "${M}landscape.webm", posterUrl: "${M}cover-edited.svg", mediaType: "video" }] },
  // a Reel with NO poster at all, portrait video
  { ...base, id: "i-b", type: "post", postId: "p-b", coverTransform: null,
    media: [{ mediaAssetId: "m-b", url: "${M}portrait.webm", posterUrl: null, mediaType: "video" }] },
  // a carousel: image cover + a portrait video with its automatic poster
  { ...base, id: "i-c", type: "post", postId: "p-c", coverTransform: null,
    media: [
      { mediaAssetId: "m-c1", url: "${M}image.svg", posterUrl: null, mediaType: "image" },
      { mediaAssetId: "m-c2", url: "${M}portrait.webm", posterUrl: "${M}poster-auto.svg", mediaType: "video" },
    ] },
  // a video that can't be loaded
  { ...base, id: "i-d", type: "post", postId: "p-d", coverTransform: null,
    media: [{ mediaAssetId: "m-d", url: "${M}missing.webm", posterUrl: "${M}poster-auto.svg", mediaType: "video" }] },
];
export default function Harness() {
  return <SharedGallery token="t" title="Viewer check" projectName="P" items={ITEMS} members={[]} />;
}
`;

const svg = (w, h, colors) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w / 2}" height="${h / 2}" fill="${colors[0]}"/><rect x="${w / 2}" width="${w / 2}" height="${h / 2}" fill="${colors[1]}"/><rect y="${h / 2}" width="${w / 2}" height="${h / 2}" fill="${colors[2]}"/><rect x="${w / 2}" y="${h / 2}" width="${w / 2}" height="${h / 2}" fill="${colors[3]}"/></svg>`;

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
    console.log(`FAIL - ${name}\n   ${String(e.message).split("\n").slice(0, 6).join("\n   ")}`);
  }
}

// VISUAL check that a video's cover is really what the player shows --
// layout, hit-testing and pixels, not DOM attributes (the cover <img> once
// had the right src but sat BELOW the player, out of view). Probes 20% in
// from the top-left: away from the centred Play icon and the Show cover pill.
async function coverPainted(page, player, rgb) {
  const g = await player.evaluate((root) => {
    const img = root.querySelector("img");
    if (!img) return { error: "no cover <img> in the player" };
    let layer = img;
    while (layer.parentElement !== root) layer = layer.parentElement;
    const r = root.getBoundingClientRect();
    const l = layer.getBoundingClientRect();
    const x = r.x + r.width * 0.2;
    const y = r.y + r.height * 0.2;
    // the transparent full-box Play button sits on top by design; what's under it is what's seen
    const seen = document.elementsFromPoint(x, y).find((e) => !e.closest("button"));
    return { r: [r.x, r.y, r.width, r.height], l: [l.x, l.y, l.width, l.height], x, y, seenIsCover: !!seen && (seen === layer || layer.contains(seen)), seen: seen?.tagName ?? null };
  });
  assert.ok(!g.error, g.error);
  const [rx, ry, rw, rh] = g.r;
  const [lx, ly, lw, lh] = g.l;
  assert.ok(lx >= rx - 1 && ly >= ry - 1 && lx + lw <= rx + rw + 1 && ly + lh <= ry + rh + 1, `cover layer ${g.l.map(Math.round)} outside player ${g.r.map(Math.round)}`);
  assert.ok(g.seenIsCover, `the visible element at the probe is ${g.seen}, not the cover`);
  const png = await page.screenshot({ clip: { x: Math.round(g.x) - 2, y: Math.round(g.y) - 2, width: 4, height: 4 } });
  const { data } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = [data[0], data[1], data[2]];
  assert.ok(px.every((v, i) => Math.abs(v - rgb[i]) <= 24), `painted rgb(${px}) is not the cover's rgb(${rgb})`);
}
// After Play: the cover is gone and the video itself is what's seen.
async function videoShown(player) {
  const g = await player.evaluate((root) => {
    const r = root.getBoundingClientRect();
    const seen = document.elementsFromPoint(r.x + r.width * 0.2, r.y + r.height * 0.6).find((e) => !e.closest("button"));
    return { mode: root.getAttribute("data-video-player"), img: !!root.querySelector("img"), seen: seen?.tagName ?? null };
  });
  assert.equal(g.mode, "playing");
  assert.equal(g.img, false, "cover hidden while playing");
  assert.equal(g.seen, "VIDEO");
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

async function recordVideo(browser, w, h) {
  const page = await browser.newPage();
  const b64 = await page.evaluate(async ([w, h]) => {
    const c = Object.assign(document.createElement("canvas"), { width: w, height: h });
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
        ctx.fillRect(0, 0, w, h);
        if (t < 3000) requestAnimationFrame(frame);
        else done();
      })();
    });
    rec.stop();
    await new Promise((r) => (rec.onstop = r));
    const buf = await new Blob(chunks, { type: "video/webm" }).arrayBuffer();
    let s = "";
    for (const byte of new Uint8Array(buf)) s += String.fromCharCode(byte);
    return btoa(s);
  }, [w, h]);
  await page.close();
  return Buffer.from(b64, "base64");
}

async function run(engine, browser, media) {
  for (const [label, viewport, mobile] of [
    ["desktop", { width: 1400, height: 900 }, false],
    ["mobile", { width: 390, height: 844 }, true],
  ]) {
    if (engine === "webkit" && mobile) continue; // one touch run (chromium) is enough; webkit covers desktop playback
    const ctx = await browser.newContext({ viewport, hasTouch: mobile, isMobile: mobile });
    const page = await ctx.newPage();
    await page.route("https://media.test/**", (r) => {
      const m = media[new URL(r.request().url()).pathname.slice(1)];
      if (!m) return r.fulfill({ status: 404, body: "" });
      // WebKit only plays media served with byte-range (206) responses --
      // real storage supports Range; a plain 200 fixture leaves WebKit's
      // <video> at 0x0 forever.
      const body = Buffer.isBuffer(m[0]) ? m[0] : Buffer.from(m[0]);
      const range = /bytes=(\d+)-(\d*)/.exec(r.request().headers()["range"] ?? "");
      if (!range) return r.fulfill({ body, contentType: m[1], headers: { "Accept-Ranges": "bytes" } });
      const start = Number(range[1]);
      const end = range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
      return r.fulfill({
        status: 206,
        body: body.subarray(start, end + 1),
        contentType: m[1],
        headers: { "Accept-Ranges": "bytes", "Content-Range": `bytes ${start}-${end}/${body.length}` },
      });
    });
    await page.goto(BASE, { waitUntil: "networkidle" });
    // Can this browser build decode the WebM fixture at all? Playwright's
    // Windows WebKit build can't (MEDIA_ERR_SRC_NOT_SUPPORTED even in a plain
    // <video autoplay muted>) -- checks that need real playback are then
    // reported as SKIPPED, never as passed.
    const decodes = await page.evaluate(async (url) => {
      const v = document.createElement("video");
      v.muted = true;
      v.src = url;
      await new Promise((r) => {
        v.onloadedmetadata = r;
        v.onerror = r;
        setTimeout(r, 6000);
      });
      return v.videoWidth > 0;
    }, `${M}landscape.webm`);
    const playbackCheck = async (name, fn) => {
      if (decodes) return check(name, fn);
      skipped++;
      console.log(`SKIP - ${name} (this browser build can't decode the WebM fixture)`);
    };
    await page.waitForSelector("[data-video-player]", { timeout: 60000 });
    await page.waitForTimeout(800);
    const tap = (loc) => (mobile ? loc.tap() : loc.click());
    const tag = `${engine} ${label}`;
    const players = page.locator("section [data-video-player]");
    const state = (loc) =>
      loc.evaluate((root) => {
        const v = root.querySelector("video");
        const img = root.querySelector("img");
        const r = root.getBoundingClientRect();
        const imgStyle = img ? getComputedStyle(img) : null;
        return {
          mode: root.getAttribute("data-video-player"),
          paused: v.paused,
          t: v.currentTime,
          controls: v.controls,
          fit: getComputedStyle(v).objectFit,
          vw: v.videoWidth,
          vh: v.videoHeight,
          img: img?.getAttribute("src") ?? null,
          imgTransform: imgStyle?.transform ?? null,
          box: { w: r.width, h: r.height },
          alert: root.querySelector("[role=alert]")?.textContent ?? null,
        };
      });
    const waitAdvance = (loc) =>
      loc.evaluate(async (root) => {
        const v = root.querySelector("video");
        const a = v.currentTime;
        await new Promise((r) => setTimeout(r, 1000));
        return { a, b: v.currentTime };
      });

    // A: edited cover + Grid framing, landscape video
    const a = players.nth(0);
    // the framed cover renders plain object-cover until the image's natural size is measured
    await a.locator("img").first().evaluate((img) =>
      new Promise((resolve) => {
        const end = Date.now() + 8000;
        (function poll() {
          if (/matrix/.test(getComputedStyle(img).transform) || Date.now() > end) resolve();
          else requestAnimationFrame(poll);
        })();
      }),
    ).catch(() => {});
    const a0 = await state(a);
    await check(`${tag}: a video shows its EDITED cover first, with the saved framing -- and doesn't autoplay`, async () => {
      assert.equal(a0.mode, "cover");
      assert.match(a0.img ?? "", /cover-edited\.svg$/);
      assert.ok(/matrix\(2,/.test(a0.imgTransform ?? ""), `framing (zoom 2) applied: ${a0.imgTransform}`);
      assert.equal(a0.paused, true);
      assert.equal(a0.t, 0);
      assert.equal(a0.controls, false);
      assert.equal(await a.getByRole("button", { name: "Play video" }).count(), 1);
    });
    // its framed (zoom 2) top-left quadrant is orange
    await check(`${tag}: VISUAL -- the standalone Reel's edited, framed cover is PAINTED in its player (inside the box, over the video)`, async () => {
      await coverPainted(page, a, [0xff, 0x80, 0x00]);
    });
    await tap(a.getByRole("button", { name: "Play video" }));
    await page.waitForTimeout(300);
    await playbackCheck(`${tag}: Play plays the ORIGINAL landscape video, whole (object-contain), with controls -- same box, no jump`, async () => {
      const s = await state(a);
      assert.equal(s.mode, "playing");
      assert.equal(s.img, null, "cover hidden while playing");
      assert.equal(s.fit, "contain");
      assert.equal(s.controls, true);
      assert.ok(s.vw > s.vh, `landscape ${s.vw}x${s.vh}`);
      assert.ok(Math.abs(s.box.w - a0.box.w) < 0.5 && Math.abs(s.box.h - a0.box.h) < 0.5, "box unchanged");
      const { a: t0, b: t1 } = await waitAdvance(a);
      assert.ok(t1 - t0 > 0.4, `advanced ${t0} -> ${t1}`);
    });
    await check(`${tag}: VISUAL -- after Play the video replaces the cover`, async () => {
      await videoShown(a);
    });
    await tap(a.getByRole("button", { name: "Show cover" }));
    await page.waitForTimeout(200);
    await check(`${tag}: VISUAL -- Show cover paints the selected cover again`, async () => {
      await coverPainted(page, a, [0xff, 0x80, 0x00]);
    });
    await check(`${tag}: Show cover returns to the cover and pauses`, async () => {
      const s = await state(a);
      assert.equal(s.mode, "cover");
      assert.equal(s.paused, true);
      assert.match(s.img ?? "", /cover-edited\.svg$/);
    });

    // B: no poster at all, portrait video
    const b = players.nth(1);
    await check(`${tag}: no cover image at all -- the paused video itself is the cover (no broken image), Play still offered`, async () => {
      const s = await state(b);
      assert.equal(s.mode, "cover");
      assert.equal(s.img, null);
      assert.equal(s.paused, true);
      assert.equal(await b.getByRole("button", { name: "Play video" }).count(), 1);
    });
    await tap(b.getByRole("button", { name: "Play video" }));
    await page.waitForTimeout(300);
    await playbackCheck(`${tag}: a portrait video plays whole (object-contain), not cropped to the box`, async () => {
      const s = await state(b);
      assert.equal(s.fit, "contain");
      assert.ok(s.vh > s.vw, `portrait ${s.vw}x${s.vh}`);
      const { a: t0, b: t1 } = await waitAdvance(b);
      assert.ok(t1 - t0 > 0.4);
    });

    // D: a video that can't load
    const d = players.nth(3);
    await tap(d.getByRole("button", { name: "Play video" }));
    await check(`${tag}: a video that can't load shows a clear message (and Show cover gets back)`, async () => {
      await d.locator("[role=alert]").waitFor({ timeout: 8000 });
      assert.match((await state(d)).alert ?? "", /can't be played/);
      await tap(d.getByRole("button", { name: "Show cover" }));
      assert.equal((await state(d)).mode, "cover");
    });

    // Lightbox (Review Content's large viewer): open the carousel's image, go to its video
    const tiles = page.locator("section button[title='View larger']");
    await tap(tiles.first());
    await page.waitForTimeout(400);
    const next = page.getByRole("button", { name: "Next", exact: true });
    for (let k = 0; k < 10; k++) {
      const html = await page.locator("div.fixed.inset-0.z-50").innerHTML();
      if (html.includes("poster-auto.svg") && html.includes("data-video-player")) break;
      await tap(next);
      await page.waitForTimeout(250);
    }
    const lb = page.locator("div.fixed.inset-0.z-50 [data-video-player]");
    await page.waitForTimeout(1200);
    await check(`${tag}: in the large viewer a video opens on its cover (automatic poster) -- NOT autoplaying`, async () => {
      const s = await state(lb);
      assert.equal(s.mode, "cover");
      assert.match(s.img ?? "", /poster-auto\.svg$/);
      assert.equal(s.paused, true);
      assert.equal(s.t, 0);
    });
    await check(`${tag}: VISUAL -- in the large viewer the carousel video's cover is PAINTED (inside the box, over the video)`, async () => {
      await coverPainted(page, lb, [0x77, 0x77, 0x77]);
    });
    await tap(lb.getByRole("button", { name: "Play video" }));
    await page.waitForTimeout(300);
    await playbackCheck(`${tag}: Play in the large viewer plays it whole; moving to another item and back shows the cover again`, async () => {
      const s = await state(lb);
      assert.equal(s.mode, "playing");
      assert.equal(s.fit, "contain");
      const { a: t0, b: t1 } = await waitAdvance(lb);
      assert.ok(t1 - t0 > 0.4);
      await tap(page.getByRole("button", { name: "Previous", exact: true }));
      await page.waitForTimeout(250);
      await tap(page.getByRole("button", { name: "Next", exact: true }));
      await page.waitForTimeout(400);
      assert.equal((await state(page.locator("div.fixed.inset-0.z-50 [data-video-player]"))).mode, "cover");
    });
    if (!mobile) {
      await check(`${tag}: keyboard -- Play is focusable and Enter plays; Escape still closes the viewer`, async () => {
        const lbPlayer = page.locator("div.fixed.inset-0.z-50 [data-video-player]");
        // start from the cover (a skipped playback step may have left it "playing")
        if ((await lbPlayer.getByRole("button", { name: "Show cover" }).count()) > 0) await lbPlayer.getByRole("button", { name: "Show cover" }).click();
        const btn = lbPlayer.getByRole("button", { name: "Play video" });
        await btn.focus();
        await page.keyboard.press("Enter");
        await page.waitForTimeout(300);
        assert.equal((await state(page.locator("div.fixed.inset-0.z-50 [data-video-player]"))).mode, "playing");
        await page.keyboard.press("Escape");
        await page.waitForTimeout(300);
        assert.equal(await page.locator("div.fixed.inset-0.z-50").count(), 0);
      });
    } else {
      await tap(page.locator("div.fixed.inset-0.z-50 button.absolute[aria-label='Close']"));
    }
    await check(`${tag}: no page overflow`, async () => {
      const w = await page.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(w <= viewport.width, `${w} > ${viewport.width}`);
    });
    await ctx.close();
  }
}

if (fs.existsSync(HARNESS_DIR)) {
  console.error(`Refusing to run: ${HARNESS_DIR} already exists.`);
  process.exit(1);
}
let server;
const browsers = [];
try {
  fs.mkdirSync(HARNESS_DIR, { recursive: true });
  fs.writeFileSync(path.join(HARNESS_DIR, "page.tsx"), HARNESS);
  server = spawn(`npx next dev --port ${PORT}`, { cwd: ROOT, shell: true, stdio: "ignore" });
  await waitForServer(BASE, 180000);
  const cr = await chromium.launch();
  browsers.push(cr);
  const media = {
    "landscape.webm": [await recordVideo(cr, 640, 360), "video/webm"],
    "portrait.webm": [await recordVideo(cr, 360, 640), "video/webm"],
    "cover-edited.svg": [svg(1080, 1440, ["#ff8000", "#8000ff", "#008080", "#ff69b4"]), "image/svg+xml"],
    "poster-auto.svg": [svg(720, 1280, ["#777777", "#777777", "#555555", "#555555"]), "image/svg+xml"],
    "image.svg": [svg(1080, 1350, ["#c0392b", "#2471a3", "#1e8449", "#d4ac0d"]), "image/svg+xml"],
  };
  console.log(`### chromium ${cr.version()}`);
  await run("chromium", cr, media);
  const wk = await webkit.launch();
  browsers.push(wk);
  console.log(`\n### webkit ${wk.version()} (Playwright build -- not Safari)`);
  await run("webkit", wk, media);
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
