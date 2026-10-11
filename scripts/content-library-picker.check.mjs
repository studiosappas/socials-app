// Opt-in REAL-BROWSER regression check for Content's "Add from library"
// picker (stories/[storyId]/story-editor.tsx) -- the "library images render
// as thin strips in Safari" bug. Not part of the default test run: it starts
// a Next dev server and needs Playwright's Chromium AND WebKit
// (npx playwright install chromium webkit).
//
//   node scripts/content-library-picker.check.mjs
//
// The bug was engine-specific layout (WebKit shrinks grid-auto-rows:auto
// tracks to fit a max-height scroll container while aspect-ratio tiles keep
// their own height and overlap), so a pure unit test can't catch it. This
// mounts the REAL Modal + REAL StoryEditor on fixture data through a
// TEMPORARY page it creates under a proxy-public path and ALWAYS deletes
// again afterwards (finally) -- same approach as
// scripts/post-editor-media-viewer.check.mjs. Media is served by request
// interception. Read-only: no database or storage is touched (the one
// server action a tile click fires is intercepted and never reaches the
// server).
//
// NOTE: Playwright's WebKit build is the same engine family as Safari but
// is NOT Safari on macOS -- a pass here is strong evidence, not a
// substitute for a real-Mac check.

import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { chromium, webkit } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HARNESS_DIR = path.join(ROOT, "src", "app", "preview-story-library-harness-check");
const PORT = 3125;
const BASE = `http://localhost:${PORT}/preview-story-library-harness-check`;
const ITEM_COUNT = 14; // > 2 desktop rows (6 cols) and > 3 mobile rows (4 cols)

const HARNESS = `"use client";
// TEMPORARY -- created and deleted by scripts/content-library-picker.check.mjs. Never commit.
import { useSearchParams } from "next/navigation";
import { Modal } from "../projects/[projectId]/modal";
import { StoryEditor } from "../projects/[projectId]/stories/[storyId]/story-editor";
import type { MediaLibraryItem } from "../projects/[projectId]/grid/grid-board";
// Mixed shapes on purpose: tall, wide and square thumbnails, a video WITH a
// poster and a video WITHOUT one (raw <video> fallback).
const library: MediaLibraryItem[] = Array.from({ length: ${ITEM_COUNT} }, (_, i) => {
  const id = "m-" + (i + 1);
  if (i === 3) return { id, url: "https://media.test/video.webm", originalUrl: "https://media.test/video.webm", mediaType: "video", posterUrl: "https://media.test/poster.svg" };
  if (i === 8) return { id, url: "https://media.test/video.webm", originalUrl: "https://media.test/video.webm", mediaType: "video", posterUrl: null };
  const shape = ["tall", "wide", "square"][i % 3];
  return { id, url: "https://media.test/thumb-" + shape + "-" + (i + 1) + ".svg", originalUrl: "https://media.test/original-" + shape + "-" + (i + 1) + ".svg", mediaType: "image" };
});
// Module-level on purpose: StoryEditor resets its frame list whenever the
// frames prop identity changes, so an inline [] would wipe an optimistic
// insert on any harness re-render (dev Fast Refresh does that).
const NO_FRAMES: never[] = [];
const NO_LINKS: never[] = [];
export default function Harness() {
  const popup = useSearchParams().get("layout") !== "page";
  const editor = (
    <StoryEditor projectId="00000000-0000-0000-0000-000000000000"
      story={{ id: "00000000-0000-0000-0000-000000000001", name: "Fixture", scheduled_date: null, status: "draft", review_status: "pending", notes: "" }}
      frames={NO_FRAMES} links={NO_LINKS} mediaLibrary={library} canManage role="owner"
      currentUserId="00000000-0000-0000-0000-000000000002" members={[]} dateFormat="DD/MM/YYYY" hideBackLink={popup} />
  );
  // Full page: same max-w-6xl container the real /projects/[id]/* layout uses.
  return popup ? <Modal onClose={() => {}}>{editor}</Modal> : <div className="mx-auto w-full max-w-6xl px-6 py-8">{editor}</div>;
}
`;

const svg = (label, w, h, color) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="${color}"/><text x="50%" y="50%" font-size="${Math.min(w, h) / 3}" text-anchor="middle" dominant-baseline="middle" fill="white">${label}</text></svg>`;
const SHAPES = { tall: [900, 1600, "#2471a3"], wide: [1600, 900, "#c0392b"], square: [1000, 1000, "#1e8449"] };

let passed = 0;
let failed = 0;
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

// Everything the assertions need, measured from what the engine actually laid out.
const measure = (page) =>
  page.evaluate(() => {
    const grid = document.querySelector("[data-story-library-grid]");
    const g = grid.getBoundingClientRect();
    const cs = getComputedStyle(grid);
    const tiles = [...grid.querySelectorAll("[data-story-library-tile]")].map((b) => {
      const r = b.getBoundingClientRect();
      const media = b.querySelector("img, video");
      const m = media?.getBoundingClientRect();
      return {
        x: r.x,
        y: r.y + grid.scrollTop,
        w: r.width,
        h: r.height,
        tag: media?.tagName ?? null,
        src: media?.getAttribute("src") ?? null,
        mw: m?.width ?? 0,
        mh: m?.height ?? 0,
        fit: media ? getComputedStyle(media).objectFit : null,
      };
    });
    return {
      tiles,
      rows: cs.gridTemplateRows.split(" ").map(parseFloat),
      cols: cs.gridTemplateColumns.split(" ").length,
      clientW: grid.clientWidth,
      scrollW: grid.scrollWidth,
      clientH: grid.clientHeight,
      scrollH: grid.scrollHeight,
      gridRight: g.right,
      docScrollW: document.documentElement.scrollWidth,
      vw: innerWidth,
    };
  });

async function run(engineName, browser, video) {
  for (const [label, viewport, mobile, layout] of [
    ["desktop popup", { width: 1280, height: 800 }, false, "popup"],
    ["desktop full page", { width: 1440, height: 900 }, false, "page"],
    ["narrow desktop popup", { width: 700, height: 800 }, false, "popup"],
    ["mobile popup", { width: 390, height: 844 }, true, "popup"],
    ["mobile full page", { width: 390, height: 844 }, true, "page"],
  ]) {
    const name = `${engineName} / ${label}`;
    const ctx = await browser.newContext({ viewport, hasTouch: mobile, isMobile: mobile && engineName !== "firefox" });
    const page = await ctx.newPage();
    const requested = [];
    await page.route("https://media.test/**", (r) => {
      const file = new URL(r.request().url()).pathname.slice(1);
      requested.push(file);
      if (file === "video.webm") return r.fulfill({ body: video, contentType: "video/webm" });
      if (file === "poster.svg") return r.fulfill({ body: svg("P", 720, 1280, "#d4ac0d"), contentType: "image/svg+xml" });
      const shape = Object.keys(SHAPES).find((s) => file.includes(`-${s}-`));
      if (!shape) return r.fulfill({ status: 404 });
      const [w, h, color] = SHAPES[shape];
      return r.fulfill({ body: svg(file.match(/(\d+)\.svg$/)[1], w, h, color), contentType: "image/svg+xml" });
    });
    // No server action ever reaches the server. The mount-time one (the
    // comments thread loading itself) is aborted: Next runs server actions
    // one at a time, so leaving it pending would queue the tile click's
    // action behind it forever. The click's own action is counted and then
    // left PENDING until the context closes -- aborting that one would
    // reject it, and a rejected transition action is surfaced to the error
    // boundary, remounting the editor and wiping the optimistic frame this
    // check is about to look at.
    const actions = [];
    await page.route(`http://localhost:${PORT}/**`, (r) => {
      const req = r.request();
      if (req.method() === "POST" && req.headers()["next-action"]) {
        actions.push(req.headers()["next-action"].slice(0, 10));
        return actions.length === 1 ? r.abort() : new Promise(() => {});
      }
      return r.continue();
    });
    await page.goto(`${BASE}?layout=${layout}`, { waitUntil: "load" });
    await page.waitForSelector("[data-story-library-grid]", { timeout: 60000 });
    // Measure the HYDRATED, committed layout: next dev can serve the HTML
    // well before React attaches, and until effects have run neither the
    // row-height measurement nor any click handler exists. The comments
    // thread loads itself from a mount effect, so its (intercepted) server
    // action is the signal that effects have committed.
    for (const end = Date.now() + 90000; actions.length === 0; ) {
      if (Date.now() > end) throw new Error("page never hydrated (no mount-time server action seen)");
      await page.waitForTimeout(100);
    }
    await page.waitForTimeout(700);
    const m = await measure(page);
    const expectedCols = viewport.width >= 640 ? 6 : 4;
    const rowCount = Math.ceil(ITEM_COUNT / expectedCols);

    await check(`${name}: all ${ITEM_COUNT} tiles in ${expectedCols} columns, ${rowCount} rows`, async () => {
      assert.equal(m.tiles.length, ITEM_COUNT);
      assert.equal(m.cols, expectedCols);
      assert.equal(m.rows.length, rowCount);
    });
    await check(`${name}: no collapsed rows -- every row is as tall as its tiles`, async () => {
      const tileH = m.tiles[0].h;
      assert.ok(tileH > 90, `tile height ${tileH}`);
      for (const row of m.rows) assert.ok(Math.abs(row - tileH) <= 1, `row ${row} vs tile ${tileH} (rows: ${m.rows})`);
    });
    await check(`${name}: every tile is 9:16 and identical in size`, async () => {
      for (const t of m.tiles) {
        // The mobile row heights are hand-tuned per breakpoint (pre-existing), so allow their rounding.
        assert.ok(Math.abs(t.w / t.h - 9 / 16) < (mobile ? 0.03 : 0.01), `tile ${t.w}x${t.h} ratio ${(t.w / t.h).toFixed(3)}`);
        assert.ok(Math.abs(t.w - m.tiles[0].w) <= 1 && Math.abs(t.h - m.tiles[0].h) <= 1);
      }
    });
    await check(`${name}: no overlapping tiles`, async () => {
      for (let i = 0; i < m.tiles.length; i++) {
        for (let j = i + 1; j < m.tiles.length; j++) {
          const a = m.tiles[i];
          const b = m.tiles[j];
          const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
          const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
          assert.ok(!(overlapX > 1 && overlapY > 1), `tiles ${i + 1} and ${j + 1} overlap by ${overlapX}x${overlapY}`);
        }
      }
    });
    await check(`${name}: media fills its tile (object-cover), thumbnails/posters -- not originals -- are what load`, async () => {
      for (const t of m.tiles) {
        assert.ok(t.tag, "tile has media");
        assert.equal(t.fit, "cover");
        assert.ok(Math.abs(t.mw - (t.w - 2)) <= 1.5 && Math.abs(t.mh - (t.h - 2)) <= 1.5, `media ${t.mw}x${t.mh} in tile ${t.w}x${t.h}`);
      }
      assert.equal(m.tiles[3].tag, "IMG"); // video with a poster renders the poster image
      assert.match(m.tiles[3].src, /poster\.svg$/);
      assert.equal(m.tiles[8].tag, "VIDEO"); // video without a poster keeps the raw <video> fallback
      assert.match(m.tiles[0].src, /thumb-tall-1\.svg$/);
      assert.equal(requested.filter((f) => f.startsWith("original-")).length, 0, `originals requested: ${requested.filter((f) => f.startsWith("original-"))}`);
    });
    await check(`${name}: no horizontal overflow (grid or page)`, async () => {
      assert.ok(m.scrollW <= m.clientW + 1, `grid scrollW ${m.scrollW} > clientW ${m.clientW}`);
      assert.ok(m.docScrollW <= m.vw + 1, `page scrollW ${m.docScrollW} > viewport ${m.vw}`);
    });
    await check(`${name}: scroll height matches the real content and the list scrolls to its last row`, async () => {
      const gap = 8;
      const expected = rowCount * m.tiles[0].h + (rowCount - 1) * gap;
      assert.ok(Math.abs(m.scrollH - expected) <= 3, `scrollH ${m.scrollH}, expected ~${expected}`);
      if (m.scrollH > m.clientH + 1) {
        const top = await page.evaluate(() => {
          const g = document.querySelector("[data-story-library-grid]");
          g.scrollTop = g.scrollHeight;
          return g.scrollTop;
        });
        assert.ok(top > 0, "grid scrolled");
        const last = await page.evaluate(() => {
          const g = document.querySelector("[data-story-library-grid]").getBoundingClientRect();
          const t = [...document.querySelectorAll("[data-story-library-tile]")].pop().getBoundingClientRect();
          return { tileBottom: t.bottom, gridBottom: g.bottom };
        });
        assert.ok(last.tileBottom <= last.gridBottom + 1.5, JSON.stringify(last));
        await page.evaluate(() => (document.querySelector("[data-story-library-grid]").scrollTop = 0));
      }
    });
    await check(`${name}: picking a tile adds exactly that asset as a frame (original, not thumbnail) and removes it from the picker`, async () => {
      const tile = page.locator("[data-story-library-tile]").nth(1);
      // Anything fired on mount (the comments thread loading itself) is not this click.
      const before = actions.length;
      if (mobile) await tile.tap();
      else await tile.click();
      await page.waitForFunction((n) => document.querySelectorAll("[data-story-library-tile]").length === n, ITEM_COUNT - 1, { timeout: 5000 });
      // Optimistic frame shows the ORIGINAL url of item 2 until the (aborted) action settles.
      await page.waitForTimeout(300);
      assert.equal(actions.length - before, 1, `server actions fired by the click: ${actions.slice(before)} (before: ${actions.slice(0, before)})`);
      assert.ok(requested.includes("original-wide-2.svg"), `requested: ${requested.filter((f) => f.includes("-2."))}`);
    });
    await page.screenshot({ path: path.join(ROOT, ".next", `content-library-${engineName}-${label.replace(/ /g, "-")}.png`) }).catch(() => {});
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await ctx.close();
  }
}

async function recordTestVideo(browser) {
  const page = await browser.newPage();
  const b64 = await page.evaluate(async () => {
    const c = Object.assign(document.createElement("canvas"), { width: 180, height: 320 });
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
        ctx.fillRect(0, 0, 180, 320);
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
  fs.mkdirSync(HARNESS_DIR, { recursive: true });
  fs.writeFileSync(path.join(HARNESS_DIR, "page.tsx"), HARNESS);
  server = spawn(`npx next dev --port ${PORT}`, { cwd: ROOT, shell: true, stdio: "ignore" });
  await waitForServer(BASE, 180000);
  const cr = await chromium.launch();
  browsers.push(cr);
  const video = await recordTestVideo(cr);
  console.log(`\n### chromium ${cr.version()}`);
  await run("chromium", cr, video);
  const wk = await webkit.launch();
  browsers.push(wk);
  console.log(`\n### webkit ${wk.version()} (Playwright build -- not Safari on macOS)`);
  await run("webkit", wk, video);
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
  // referencing the deleted harness page and break `tsc`/`next build`.
  fs.rmSync(path.join(ROOT, ".next", "dev", "types"), { recursive: true, force: true });
}
console.log(`\n${passed} checks passed, ${failed} failed`);
if (failed) process.exit(1);
