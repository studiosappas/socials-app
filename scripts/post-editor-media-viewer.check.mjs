// Opt-in REAL-BROWSER regression check for the Post Editor popup's media
// viewer (posts/[postId]/post-media-viewer.tsx). Not part of the default
// test run -- it needs Microsoft Edge (or Chrome) and starts a Next dev
// server.
//
//   node scripts/post-editor-media-viewer.check.mjs
//
// The Grid's Post Editor popup normally needs a logged-in session and real
// project data, so this mounts the REAL Modal + REAL PostEditor (with the
// REAL viewer and Review Content's REAL Lightbox) on fixture data, through a
// TEMPORARY page it creates under a proxy-public path and ALWAYS deletes
// again afterwards (finally) -- nothing it creates is ever meant to be
// committed or shipped. Media is served by request interception; the test
// video is recorded in the browser (MediaRecorder), so no third-party media
// is needed. Read-only: no database or storage is touched.

import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HARNESS_DIR = path.join(ROOT, "src", "app", "preview-viewer-harness-check");
const PORT = 3124;
const BASE = `http://localhost:${PORT}/preview-viewer-harness-check`;

const HARNESS = `"use client";
// TEMPORARY -- created and deleted by scripts/post-editor-media-viewer.check.mjs. Never commit.
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Modal } from "../projects/[projectId]/modal";
import { PostEditor, type PostAssetItem } from "../projects/[projectId]/posts/[postId]/post-editor";
const a = (id: string, url: string, mediaType: "image" | "video", posterUrl: string | null = null): PostAssetItem =>
  ({ postAssetId: "pa-" + id, mediaAssetId: "m-" + id, url, originalUrl: url, annotationJson: null, mediaType, posterUrl });
const assets = [a("1", "https://media.test/img-1.svg", "image"), a("2", "https://media.test/video-2.webm", "video", "https://media.test/poster-2.svg"), a("3", "https://media.test/img-3.svg", "image"), a("4", "https://media.test/img-4.svg", "image")];
export default function Harness() {
  const viewerOn = useSearchParams().get("viewer") !== "off";
  const [closes, setCloses] = useState(0);
  return (
    <div data-modal-closes={closes}>
      {closes === 0 && (
        <Modal onClose={() => setCloses((c) => c + 1)}>
          <PostEditor projectId="00000000-0000-0000-0000-000000000000"
            post={{ id: "00000000-0000-0000-0000-000000000001", post_type: "carousel", caption: "", notes: "", scheduled_date: null, scheduled_time: null, status: "draft", review_status: "pending", coverTransform: { scale: 1.4, x: 0.05, y: 0, rotation: 0 } }}
            assets={assets} links={[]} mediaLibraryPromise={Promise.resolve([])} canManage role="owner"
            currentUserId="00000000-0000-0000-0000-000000000002" members={[]} dateFormat="DD/MM/YYYY" hideBackLink enableMediaViewer={viewerOn} />
        </Modal>
      )}
    </div>
  );
}
`;

const svg = (label, w, h, color) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="${color}"/><text x="50%" y="50%" font-size="${Math.min(w, h) / 3}" text-anchor="middle" dominant-baseline="middle" fill="white">${label}</text></svg>`;

let passed = 0;
let failed = 0;
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

async function recordTestVideo(browser) {
  const page = await browser.newPage();
  const b64 = await page.evaluate(async () => {
    const c = Object.assign(document.createElement("canvas"), { width: 360, height: 480 });
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
        ctx.fillRect(0, 0, 360, 480);
        ctx.fillStyle = "white";
        ctx.font = "120px sans-serif";
        ctx.fillText(String(Math.floor(t / 250)), 120, 280);
        if (t < 2500) requestAnimationFrame(frame);
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

async function run(browser, video) {
  const MEDIA = {
    "img-1.svg": [svg("1", 1600, 900, "#c0392b"), "image/svg+xml"],
    "poster-2.svg": [svg("2", 720, 900, "#d4ac0d"), "image/svg+xml"],
    "img-3.svg": [svg("3", 900, 1600, "#2471a3"), "image/svg+xml"],
    "img-4.svg": [svg("4", 1000, 1000, "#1e8449"), "image/svg+xml"],
    "video-2.webm": [video, "video/webm"],
  };
  async function setup(viewport, opts = {}) {
    const ctx = await browser.newContext({ viewport, hasTouch: !!opts.mobile, isMobile: !!opts.mobile });
    const page = await ctx.newPage();
    await page.route("https://media.test/**", (r) => {
      const m = MEDIA[new URL(r.request().url()).pathname.slice(1)];
      return m ? r.fulfill({ body: m[0], contentType: m[1] }) : r.fulfill({ status: 404 });
    });
    const actions = [];
    page.on("request", (req) => {
      if (req.method() === "POST" && req.headers()["next-action"]) actions.push(req.url());
    });
    await page.goto(BASE + (opts.query ?? ""), { waitUntil: "networkidle" });
    await page.waitForSelector("text=Close X", { timeout: 60000 });
    await page.waitForTimeout(500);
    return { ctx, page, actions };
  }
  const viewerOpen = (page) => page.locator("[data-post-media-viewer]").count().then((n) => n > 0);
  const waitViewer = (page) => page.waitForSelector("[data-post-media-viewer]", { state: "attached", timeout: 8000 });
  const modalCloses = (page) => page.locator("[data-modal-closes]").getAttribute("data-modal-closes").then(Number);
  const editorMounted = (page) => page.getByText("Close X").count().then((n) => n === 1);
  const viewerState = (page) =>
    page.evaluate(() => {
      const root = document.querySelector("[data-post-media-viewer]");
      if (!root) return null;
      const counter = [...root.querySelectorAll("span")].map((s) => s.textContent.trim()).find((t) => /^\d+ \/ \d+$/.test(t)) ?? null;
      const video = root.querySelector("video");
      const img = root.querySelector("img");
      const box = (video ?? img)?.closest("div.animate-settle-in");
      const r = box?.getBoundingClientRect();
      const c = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
      return {
        counter,
        video: video?.getAttribute("src") ?? null,
        img: img?.getAttribute("src") ?? null,
        box: r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null,
        vw: innerWidth,
        vh: innerHeight,
        topmostIsViewer: !!c?.closest("[data-post-media-viewer]"),
        scrollW: document.documentElement.scrollWidth,
      };
    });

  for (const [label, viewport, mobile] of [
    ["desktop", { width: 1400, height: 900 }, false],
    ["mobile", { width: 390, height: 844 }, true],
  ]) {
    console.log(`\n### ${label} ${viewport.width}x${viewport.height}`);
    const { ctx, page, actions } = await setup(viewport, { mobile });
    const click = (loc) => (mobile ? loc.tap() : loc.click());
    const tile = (i) => page.locator("[data-post-media-preview]").nth(i);
    const viewerBtn = (name) => page.locator(`[data-post-media-viewer] button[aria-label='${name}']`).last();

    await check(`${label}: popup open with 4 media tiles, no viewer`, async () => {
      assert.equal(await editorMounted(page), true);
      assert.equal(await page.locator("[data-post-media-preview]").count(), 4);
      assert.equal(await viewerOpen(page), false);
    });
    const caption = page.locator("textarea").first();
    await caption.fill("typed before opening the viewer");
    await check(`${label}: clicking item 3 opens the viewer ON item 3, top-most, editor still mounted`, async () => {
      await click(tile(2));
      await waitViewer(page);
      const s = await viewerState(page);
      assert.equal(s.counter, "3 / 4");
      assert.match(s.img, /img-3\.svg/);
      assert.equal(s.topmostIsViewer, true);
      assert.equal(await editorMounted(page), true);
    });
    await check(`${label}: viewer fits the viewport in Review Content's 3:4 box, no page overflow`, async () => {
      const s = await viewerState(page);
      assert.ok(s.box.x >= -0.5 && s.box.y >= -0.5 && s.box.x + s.box.w <= s.vw + 0.5 && s.box.y + s.box.h <= s.vh + 0.5, JSON.stringify(s));
      assert.ok(Math.abs(s.box.w / s.box.h - 0.75) < 0.01);
      assert.ok(s.scrollW <= s.vw);
    });
    await check(`${label}: next/prev follow carousel order and loop (3 -> 4 -> 1 -> 2 -> 1 -> 4)`, async () => {
      const seq = [];
      for (const b of ["Next", "Next", "Next", "Previous", "Previous"]) {
        await click(viewerBtn(b));
        seq.push((await viewerState(page)).counter);
      }
      assert.deepEqual(seq, ["4 / 4", "1 / 4", "2 / 4", "1 / 4", "4 / 4"]);
    });
    await check(`${label}: item 2 is the real video (poster only as poster) and it plays`, async () => {
      await click(viewerBtn("Next"));
      await click(viewerBtn("Next"));
      const s = await viewerState(page);
      assert.equal(s.counter, "2 / 4");
      assert.match(s.video, /video-2\.webm$/);
      const t = await page.evaluate(async () => {
        const v = document.querySelector("[data-post-media-viewer] video");
        v.muted = true;
        await new Promise((r) => (v.readyState >= 2 ? r() : ((v.onloadeddata = r), setTimeout(r, 5000))));
        await v.play().catch(() => {});
        const a = v.currentTime;
        await new Promise((r) => setTimeout(r, 900));
        return { a, b: v.currentTime, w: v.videoWidth, poster: v.getAttribute("poster") };
      });
      assert.ok(t.b - t.a > 0.4, `advanced ${t.a} -> ${t.b}`);
      assert.ok(t.w > 0);
      assert.match(t.poster, /poster-2\.svg$/);
    });
    if (!mobile) {
      await check(`${label}: arrows navigate; Escape closes ONLY the viewer (the popup's own Escape never fires)`, async () => {
        await page.keyboard.press("ArrowRight");
        assert.equal((await viewerState(page)).counter, "3 / 4");
        await page.keyboard.press("ArrowLeft");
        assert.equal((await viewerState(page)).counter, "2 / 4");
        await page.keyboard.press("Escape");
        assert.equal(await viewerOpen(page), false);
        assert.equal(await editorMounted(page), true);
        assert.equal(await modalCloses(page), 0);
      });
      await check(`${label}: undo/redo shortcuts are swallowed while the viewer is open`, async () => {
        await click(tile(0));
        await waitViewer(page);
        await page.keyboard.press("Control+z");
        await page.keyboard.press("Control+Shift+z");
        assert.equal(await viewerOpen(page), true);
        await page.keyboard.press("Escape");
        assert.equal(await modalCloses(page), 0);
      });
    } else {
      await click(viewerBtn("Close"));
    }
    await check(`${label}: X closes ONLY the viewer (item 1 opens on item 1)`, async () => {
      await click(tile(0));
      await waitViewer(page);
      assert.equal((await viewerState(page)).counter, "1 / 4");
      await click(viewerBtn("Close"));
      assert.equal(await viewerOpen(page), false);
      assert.equal(await editorMounted(page), true);
      assert.equal(await modalCloses(page), 0);
    });
    await check(`${label}: clicking the empty area never reaches the popup underneath`, async () => {
      await click(tile(3));
      await waitViewer(page);
      const hit = await page.evaluate(([x, y]) => {
        const el = document.elementFromPoint(x, y);
        return { inViewer: !!el?.closest("[data-post-media-viewer]"), isBackdrop: el?.tagName === "BUTTON" && el.getAttribute("aria-label") === "Close" };
      }, [8, viewport.height - 8]);
      assert.equal(hit.inViewer, true);
      if (mobile) await page.touchscreen.tap(8, viewport.height - 8);
      else await page.mouse.click(8, viewport.height - 8);
      await page.waitForTimeout(200);
      assert.equal(await modalCloses(page), 0);
      assert.equal(await viewerOpen(page), !hit.isBackdrop);
      if (await viewerOpen(page)) await click(viewerBtn("Close"));
      assert.equal(await editorMounted(page), true);
    });
    await check(`${label}: editor state preserved (typed caption intact)`, async () => {
      assert.equal(await caption.inputValue(), "typed before opening the viewer");
    });
    await check(`${label}: ⋮ menu doesn't open the viewer; dismissing it by clicking the media doesn't either`, async () => {
      await click(page.locator("button[title='Frame options']").nth(2));
      await page.waitForTimeout(200);
      assert.ok((await page.getByRole("button", { name: "Replace" }).count()) > 0);
      assert.equal(await viewerOpen(page), false);
      await click(tile(2));
      await page.waitForTimeout(300);
      assert.equal(await viewerOpen(page), false);
    });
    await check(`${label}: Crop opens the crop overlay, not the viewer`, async () => {
      await click(page.locator("button[title='Frame options']").nth(0));
      await page.waitForTimeout(200);
      await click(page.getByRole("button", { name: "Crop", exact: true }));
      await page.waitForTimeout(500);
      assert.equal(await viewerOpen(page), false);
      const cancel = page.getByRole("button", { name: "Cancel", exact: true });
      assert.ok((await cancel.count()) > 0);
      await click(cancel.first());
      await page.waitForTimeout(300);
      assert.equal(await viewerOpen(page), false);
      assert.equal(await editorMounted(page), true);
    });
    await check(`${label}: opening/navigating/closing sends NO server actions (read-only)`, async () => {
      const before = actions.length;
      await click(tile(1));
      await waitViewer(page);
      await click(viewerBtn("Next"));
      await click(viewerBtn("Previous"));
      await click(viewerBtn("Close"));
      await page.waitForTimeout(500);
      assert.equal(actions.length - before, 0, String(actions.slice(before)));
    });
    if (!mobile) {
      await check(`${label}: drag-to-reorder doesn't open the viewer`, async () => {
        const a = await tile(3).boundingBox();
        const b = await tile(2).boundingBox();
        await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
        await page.mouse.down();
        for (let k = 1; k <= 10; k++) await page.mouse.move(a.x + a.width / 2 - ((a.x - b.x) * k) / 10, a.y + a.height / 2, { steps: 2 });
        await page.mouse.up();
        await page.waitForTimeout(500);
        assert.equal(await viewerOpen(page), false);
      });
    }
    await check(`${label}: the popup's own close still works normally afterwards`, async () => {
      if (mobile) await click(page.getByText("Close X"));
      else await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      assert.equal(await modalCloses(page), 1);
    });
    await ctx.close();
  }

  const { ctx, page } = await setup({ width: 1400, height: 900 }, { query: "?viewer=off" });
  await check("without enableMediaViewer (full-page post route, Tasks popup): media click does nothing", async () => {
    assert.equal(await page.locator("[data-post-media-preview]").count(), 0);
    await page.locator("img[src*='img-3.svg']").first().click({ force: true });
    await page.waitForTimeout(300);
    assert.equal(await viewerOpen(page), false);
    assert.equal(await modalCloses(page), 0);
  });
  await ctx.close();
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
  await run(browser, await recordTestVideo(browser));
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
  // next dev registers every route it compiled in generated type stubs
  // (.next/dev/types, included by tsconfig). Left alone, they'd keep
  // referencing the deleted harness page and break `tsc`/`next build`.
  // Regenerated by the next `next dev` run.
  fs.rmSync(path.join(ROOT, ".next", "dev", "types"), { recursive: true, force: true });
}
console.log(`\n${passed} checks passed, ${failed} failed`);
if (failed) process.exit(1);
