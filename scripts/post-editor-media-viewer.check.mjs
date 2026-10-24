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
// Module-level and in the paged LibraryPage shape (Issue 6) -- an inline
// Promise.resolve per render re-suspends use(), and [] has no .entries.
const LIBRARY = Promise.resolve({ entries: [], nextCursor: null, hasMore: false });
export default function Harness() {
  const params = useSearchParams();
  const viewerOn = params.get("viewer") !== "off";
  // ?stored=reel: an older mixed carousel saved as "reel" by the old type rule (D1)
  const storedType = params.get("stored") === "reel" ? "reel" : "carousel";
  const [closes, setCloses] = useState(0);
  return (
    <div data-modal-closes={closes}>
      {closes === 0 && (
        <Modal onClose={() => setCloses((c) => c + 1)}>
          <PostEditor projectId="00000000-0000-0000-0000-000000000000"
            post={{ id: "00000000-0000-0000-0000-000000000001", post_type: storedType, caption: "", notes: "", scheduled_date: null, scheduled_time: null, status: "draft", review_status: "pending", coverTransform: { scale: 1.4, x: 0.05, y: 0, rotation: 0 } }}
            assets={assets} links={[]} mediaLibraryPromise={LIBRARY} canManage role="owner"
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
    await check(`${label}: item 2 (a video) opens on its COVER, not autoplaying; Play plays the real video, whole`, async () => {
      await click(viewerBtn("Next"));
      await click(viewerBtn("Next"));
      const s = await viewerState(page);
      assert.equal(s.counter, "2 / 4");
      assert.match(s.video, /video-2\.webm$/);
      assert.match(s.img, /poster-2\.svg$/, "the cover image is what shows first");
      await page.waitForTimeout(800);
      const before = await page.evaluate(() => {
        const v = document.querySelector("[data-post-media-viewer] video");
        return { paused: v.paused, t: v.currentTime };
      });
      assert.equal(before.paused, true, "no autoplay");
      assert.equal(before.t, 0);
      await click(page.locator("[data-post-media-viewer] button[aria-label='Play video']"));
      const t = await page.evaluate(async () => {
        const v = document.querySelector("[data-post-media-viewer] video");
        await new Promise((r) => (v.readyState >= 2 ? r() : ((v.onloadeddata = r), setTimeout(r, 5000))));
        const a = v.currentTime;
        await new Promise((r) => setTimeout(r, 900));
        return { a, b: v.currentTime, w: v.videoWidth, fit: getComputedStyle(v).objectFit };
      });
      assert.ok(t.b - t.a > 0.4, `advanced ${t.a} -> ${t.b}`);
      assert.ok(t.w > 0);
      assert.equal(t.fit, "contain");
      await click(page.locator("[data-post-media-viewer] button", { hasText: "Show cover" }));
      assert.match((await viewerState(page)).img, /poster-2\.svg$/);
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
    await check(`${label}: the Crop stage is ENLARGED and centred (same 3:4 as the 96x128 tile), inside the viewport`, async () => {
      await click(page.locator("button[title='Frame options']").nth(0));
      await page.waitForTimeout(200);
      await click(page.getByRole("button", { name: "Crop", exact: true }));
      await page.waitForTimeout(500);
      const tileBox = await tile(0).boundingBox();
      const f = await page.locator("div.fixed.z-\\[101\\] > div").first().boundingBox();
      assert.ok(Math.abs(f.width / f.height - 0.75) < 0.01, `aspect ${JSON.stringify(f)}`);
      assert.ok(f.height >= 3 * tileBox.height, `frame ${f.width}x${f.height} vs tile ${tileBox.width}x${tileBox.height}`);
      assert.ok(f.x >= 0 && f.y >= 0 && f.x + f.width <= viewport.width && f.y + f.height <= viewport.height, JSON.stringify(f));
      assert.ok(Math.abs(f.x + f.width / 2 - viewport.width / 2) < 2 && Math.abs(f.y + f.height / 2 - viewport.height / 2) < 2, "centred");
      if (!mobile) {
        // Escape cancels the crop ONLY -- the Post Editor popup stays open
        await page.keyboard.press("Escape");
        await page.waitForTimeout(300);
        assert.equal(await page.locator("div.fixed.z-\\[101\\]").count(), 0, "crop closed");
        assert.equal(await modalCloses(page), 0, "popup not closed");
        assert.equal(await editorMounted(page), true);
      } else {
        await click(page.getByRole("button", { name: "Cancel", exact: true }).first());
        await page.waitForTimeout(300);
      }
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

  // --- D1: an older mixed carousel stored as "reel" -------------------------
  // Server Action requests are captured and ABORTED here: nothing reaches a
  // real backend, only the request body the editor would send is inspected.
  {
    const legacy = await setup({ width: 1400, height: 900 }, { query: "?stored=reel" });
    const bodies = [];
    await legacy.page.route("**/*", (route) => {
      const req = route.request();
      if (req.method() === "POST" && req.headers()["next-action"]) {
        bodies.push(req.postData() ?? "");
        return route.abort();
      }
      return route.fallback();
    });
    const pill = (name) => legacy.page.getByRole("button", { name, exact: true });
    const selected = async () => {
      for (const n of ["post", "reel", "carousel"]) {
        if (/bg-foreground/.test((await pill(n).getAttribute("class")) ?? "")) return n;
      }
      return null;
    };
    await check("D1: a 4-item post stored as 'reel' shows Post Type CAROUSEL in the Post Editor", async () => {
      assert.equal(await selected(), "carousel");
    });
    await check("D1: Save without picking a type does NOT send post_type (the stored value is left as is)", async () => {
      await legacy.page.locator("textarea").first().fill("caption only");
      await legacy.page.getByRole("button", { name: "Save Changes" }).click();
      await legacy.page.waitForTimeout(1000);
      const save = bodies.find((b) => b.includes("caption only"));
      assert.ok(save, `a save request was made (${bodies.length} captured)`);
      assert.ok(!/post_type/.test(save), "no post_type in the save");
    });
    await legacy.ctx.close();
  }
  {
    // fresh page: an aborted Server Action leaves the dev page in an error state
    const picked = await setup({ width: 1400, height: 900 }, { query: "?stored=reel" });
    const bodies = [];
    await picked.page.route("**/*", (route) => {
      const req = route.request();
      if (req.method() === "POST" && req.headers()["next-action"]) {
        bodies.push(req.postData() ?? "");
        return route.abort();
      }
      return route.fallback();
    });
    await check("D1: an explicit pick is still sent on Save (manual override unchanged)", async () => {
      await picked.page.getByRole("button", { name: "post", exact: true }).click();
      await picked.page.getByRole("button", { name: "Save Changes" }).click();
      await picked.page.waitForTimeout(1000);
      assert.ok(bodies.some((b) => /post_type[\s\S]{0,80}post/.test(b)), `bodies: ${bodies.map((b) => b.slice(0, 200)).join(" | ")}`);
    });
    await picked.ctx.close();
  }

  // --- D2: only an explicit, real NEW crop writes the Grid-preview marker ---
  {
    const s = await setup({ width: 1400, height: 900 });
    const bodies = [];
    await s.page.route("**/*", (route) => {
      const req = route.request();
      if (req.method() === "POST" && req.headers()["next-action"]) {
        bodies.push(req.postData() ?? "");
        // let the optimistic crop stand: answer instead of aborting
        return route.fulfill({ status: 200, contentType: "text/x-component", body: '0:{"a":"$@1","f":"","b":"dev"}\n1:null\n' });
      }
      return route.fallback();
    });
    const openCrop = async () => {
      await s.page.locator("button[title='Frame options']").nth(0).click();
      await s.page.waitForTimeout(200);
      await s.page.getByRole("button", { name: "Crop", exact: true }).click();
      await s.page.waitForTimeout(500);
    };
    const save = () => s.page.locator("div.fixed[class~='z-[101]']").getByRole("button", { name: "Save", exact: true }).click();
    const cropWrites = () => bodies.filter((b) => /"scale"/.test(b));
    const tileTransform = () => s.page.evaluate(() => getComputedStyle(document.querySelector("[data-post-media-preview] img")).transform);
    const legacyTile = await tileTransform();
    await check("D2: opening Crop and saving WITHOUT changing it writes nothing (an old framing is never marked)", async () => {
      await openCrop();
      await save();
      await s.page.waitForTimeout(800);
      assert.deepEqual(cropWrites(), []);
    });
    await check("D2: a real new crop is written WITH { scope: 'grid-preview', scopeVersion: 1 } and the framing", async () => {
      await openCrop();
      const f = await s.page.locator("div.fixed[class~='z-[101]'] > div").first().boundingBox();
      await s.page.mouse.move(f.x + f.width / 2, f.y + f.height / 2);
      await s.page.mouse.down();
      await s.page.mouse.move(f.x + f.width / 2 + 40, f.y + f.height / 2, { steps: 5 });
      await s.page.mouse.up();
      await save();
      await s.page.waitForTimeout(1000);
      const w = cropWrites();
      assert.equal(w.length, 1, w.join(" | "));
      const arg = JSON.parse(w[0]).find((a) => a && typeof a === "object" && "scale" in a);
      assert.equal(arg.scope, "grid-preview");
      assert.equal(arg.scopeVersion, 1);
      assert.ok(typeof arg.scale === "number" && typeof arg.x === "number" && typeof arg.y === "number", JSON.stringify(arg));
    });
    await check("D2: the cover tile shows the NEW crop (Grid preview kept)", async () => {
      const t = await tileTransform();
      assert.ok(t && t !== "none", String(t));
      assert.notEqual(t, legacyTile, "the tile moved to the new framing");
    });
    await check("D2: reopening and saving the marked crop unchanged, then Save Changes on the caption, never rewrites the framing", async () => {
      const before = cropWrites().length;
      await openCrop();
      await save();
      await s.page.waitForTimeout(600);
      await s.page.locator("textarea").first().fill("caption after crop");
      await s.page.getByRole("button", { name: "Save Changes" }).click();
      await s.page.waitForTimeout(1000);
      assert.equal(cropWrites().length, before, "no new crop write");
      const saveBody = bodies.find((b) => b.includes("caption after crop"));
      assert.ok(saveBody, "the caption save was sent");
      assert.ok(!/grid-preview|cover_transform|scopeVersion/.test(saveBody), "Save Changes doesn't touch the framing");
    });
    await s.ctx.close();
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
