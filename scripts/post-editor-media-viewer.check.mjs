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
import { chromium, webkit } from "playwright";
import sharp from "sharp";

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
// ?reel=none|legacy|marked: a STANDALONE Reel (the video alone, position 0) whose
// cover was saved through Edit Cover, with no / a legacy / a marked Grid framing
const REEL = [{ ...a("r", "https://media.test/video-2.webm", "video", "https://media.test/reel-cover.jpg"), annotationJson: { objects: [] }, coverEdited: true }];
const REEL_FRAMING = {
  none: null,
  legacy: { scale: 1.4, x: 0.05, y: 0, rotation: 0 },
  marked: { scale: 1.4, x: 0.05, y: 0, rotation: 0, scope: "grid-preview", scopeVersion: 1 },
} as const;
export default function Harness() {
  const params = useSearchParams();
  const reel = params.get("reel") as keyof typeof REEL_FRAMING | null;
  const viewerOn = params.get("viewer") !== "off";
  // ?stored=reel: an older mixed carousel saved as "reel" by the old type rule (D1)
  const storedType = params.get("stored") === "reel" ? "reel" : "carousel";
  const [closes, setCloses] = useState(0);
  return (
    <div data-modal-closes={closes}>
      {closes === 0 && (
        // ?modal=router: the Modal's REAL default close (router.back()), as on the intercepted route
        <Modal onClose={params.get("modal") === "router" ? undefined : () => setCloses((c) => c + 1)}>
          <PostEditor projectId="00000000-0000-0000-0000-000000000000"
            post={{ id: "00000000-0000-0000-0000-000000000001", post_type: reel ? "reel" : storedType, caption: "", notes: "", scheduled_date: null, scheduled_time: null, status: "draft", review_status: "pending", coverTransform: reel ? REEL_FRAMING[reel] : { scale: 1.4, x: 0.05, y: 0, rotation: 0 } }}
            assets={reel ? REEL : assets} links={[]} mediaLibraryPromise={LIBRARY} canManage role="owner"
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

// Cover-first, VISUALLY, in the Post Editor's large viewer -- Chromium and
// WebKit. The cover is a solid magenta JPEG no video frame matches.
async function runCoverVisual(engine, browser, video) {
  console.log(`\n### cover-first, visual -- ${engine} ${browser.version()}${engine === "webkit" ? " (Playwright build -- not Safari)" : ""}`);
  const MEDIA = {
    "reel-cover.jpg": [await sharp({ create: { width: 1080, height: 1920, channels: 3, background: "#ff00ff" } }).jpeg().toBuffer(), "image/jpeg"],
    "poster-2.svg": [svg("2", 720, 900, "#d4ac0d"), "image/svg+xml"],
    "img-1.svg": [svg("1", 1600, 900, "#c0392b"), "image/svg+xml"],
    "img-3.svg": [svg("3", 900, 1600, "#2471a3"), "image/svg+xml"],
    "img-4.svg": [svg("4", 1000, 1000, "#1e8449"), "image/svg+xml"],
    "video-2.webm": [video, "video/webm"],
  };
  const MAGENTA = [255, 0, 255];
  const YELLOW = [0xd4, 0xac, 0x0d];
  const open = async (query, tileIndex) => {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await ctx.newPage();
    await page.route("https://media.test/**", (r) => {
      const m = MEDIA[new URL(r.request().url()).pathname.slice(1)];
      return m ? r.fulfill({ body: m[0], contentType: m[1] }) : r.fulfill({ status: 404 });
    });
    await page.goto(BASE + query, { waitUntil: "networkidle" });
    await page.waitForSelector("text=Close X", { timeout: 60000 });
    await page.waitForTimeout(500);
    await page.locator("[data-post-media-preview]").nth(tileIndex).click();
    await page.waitForSelector("[data-post-media-viewer] [data-video-player]", { state: "attached", timeout: 8000 });
    const player = page.locator("[data-post-media-viewer] [data-video-player]");
    // loaded, and -- for a framed cover -- past the plain object-cover first render
    await player.locator("img").first().evaluate((img) =>
      new Promise((resolve) => {
        const end = Date.now() + 8000;
        (function poll() {
          if ((img.complete && img.naturalWidth > 0) || Date.now() > end) resolve();
          else requestAnimationFrame(poll);
        })();
      }),
    ).catch(() => {});
    await page.waitForTimeout(600);
    return { ctx, page, player };
  };
  for (const framing of ["none", "legacy", "marked"]) {
    const { ctx, page, player } = await open(`?reel=${framing}`, 0);
    await check(`${engine}: standalone Reel (position 0), ${framing} framing -- the selected cover is PAINTED in the large viewer, before Play`, async () => {
      assert.equal(await player.getAttribute("data-video-player"), "cover");
      assert.equal(await page.evaluate(() => document.querySelector("[data-post-media-viewer] video").paused), true, "no autoplay");
      await coverPainted(page, player, MAGENTA);
    });
    await check(`${engine}: standalone Reel, ${framing} framing -- Play shows the video; Show cover paints the selected cover again`, async () => {
      await player.getByRole("button", { name: "Play video" }).click();
      await page.waitForTimeout(400);
      await videoShown(player);
      await player.getByRole("button", { name: "Show cover" }).click();
      await page.waitForTimeout(400);
      assert.equal(await player.getAttribute("data-video-player"), "cover");
      await coverPainted(page, player, MAGENTA);
    });
    await ctx.close();
  }
  {
    const { ctx, page, player } = await open("", 1);
    await check(`${engine}: a video inside a carousel -- its cover is PAINTED in the large viewer, and comes back after Play / Show cover`, async () => {
      await coverPainted(page, player, YELLOW);
      await player.getByRole("button", { name: "Play video" }).click();
      await page.waitForTimeout(400);
      await videoShown(player);
      await player.getByRole("button", { name: "Show cover" }).click();
      await page.waitForTimeout(400);
      await coverPainted(page, player, YELLOW);
    });
    await ctx.close();
  }
}

// Escape closes ONLY the topmost layer, with the REAL Post Editor Modal and
// the REAL annotation editor (Edit Image) together: once with the harness's
// close counter, once with the Modal's real router.back() (history.back is
// recorded, not followed). Server Actions are recorded and aborted -- none
// may be sent by any of this.
async function runEditImageEscape(engine, browser) {
  console.log(`\n### Escape, topmost layer only -- ${engine} ${browser.version()}${engine === "webkit" ? " (Playwright build -- not Safari)" : ""}`);
  const photo = await sharp({ create: { width: 1200, height: 1600, channels: 3, background: "#2471a3" } })
    .composite([{ input: await sharp({ create: { width: 600, height: 800, channels: 3, background: "#d4ac0d" } }).png().toBuffer(), left: 300, top: 400 }])
    .png()
    .toBuffer();
  const open = async (query) => {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      window.__backs = 0;
      history.back = () => void window.__backs++;
    });
    await page.route("https://media.test/**", (r) => r.fulfill({ body: photo, contentType: "image/png", headers: { "access-control-allow-origin": "*" } }));
    const actions = [];
    await page.route(`http://localhost:${PORT}/**`, (r) => {
      if (r.request().method() === "POST" && r.request().headers()["next-action"]) {
        actions.push(r.request().postData() ?? "");
        return r.abort();
      }
      return r.fallback();
    });
    await page.goto(BASE + query, { waitUntil: "networkidle" });
    await page.waitForSelector("text=Close X", { timeout: 60000 });
    await page.waitForTimeout(500);
    return { ctx, page, actions };
  };
  const frameMenu = async (page, item) => {
    for (const end = Date.now() + 60000; ; ) {
      await page.locator("button[title='Frame options']").first().click();
      if (await page.getByRole("button", { name: item, exact: true }).count()) break;
      if (Date.now() > end) throw new Error(`menu item ${item} never appeared`);
      await page.waitForTimeout(300);
    }
    await page.getByRole("button", { name: item, exact: true }).click();
  };
  const openEditImage = async (page) => {
    await frameMenu(page, "Edit Image");
    await page.locator("button[title='Crop Image']").first().waitFor({ timeout: 30000 });
    await page.waitForFunction(() => {
      const el = [...document.querySelectorAll("p")].find((p) => p.textContent === "Loading image…");
      return el && getComputedStyle(el.parentElement).display === "none";
    }, null, { timeout: 30000 });
    await page.waitForTimeout(400);
  };
  // closes of the Post Editor, whichever close the Modal uses
  const editorCloses = (page) => page.evaluate(() => Number(document.querySelector("[data-modal-closes]").getAttribute("data-modal-closes")) + window.__backs);
  const layers = (page) => page.evaluate(() => ({
    editImage: !!document.querySelector("button[title='Crop Image']"),
    cropTool: [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Apply crop"),
    gridCropOverlay: !!document.querySelector("div.fixed[class~='z-[101]']"),
  }));
  const canvasShot = async (page) => sharp(await page.locator(".canvas-container").screenshot()).removeAlpha().resize(48, 60, { fit: "fill" }).raw().toBuffer();
  const diff = (a, b) => {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
    return s / a.length;
  };

  for (const mode of ["counter", "router"]) {
    const q = mode === "router" ? "?modal=router" : "";
    const tag = `${engine} [${mode === "router" ? "real router.back() close" : "close counter"}]`;
    for (const [how, leave] of [
      ["Escape", (page) => page.keyboard.press("Escape")],
      ["Cancel crop", (page) => page.getByRole("button", { name: "Cancel crop" }).click()],
    ]) {
      const { ctx, page, actions } = await open(q);
      await openEditImage(page);
      const before = await canvasShot(page);
      const sent = actions.length;
      await page.locator("button[title='Crop Image']").first().click();
      await page.getByRole("button", { name: "Apply crop" }).waitFor();
      await page.waitForTimeout(250);
      const f = await page.locator("div.absolute.z-10.bg-background").boundingBox();
      await page.mouse.move(f.x + f.width / 2, f.y + f.height / 2);
      await page.mouse.down();
      await page.mouse.move(f.x + f.width / 2 + 60, f.y + f.height / 2 + 30, { steps: 6 }); // unapplied
      await page.mouse.up();
      await leave(page);
      await page.waitForTimeout(500);
      await check(`${tag}: Edit Image -> Crop Image -> ${how}: ONLY the crop tool closes; Edit Image and the Post Editor stay open; nothing applied or saved`, async () => {
        const l = await layers(page);
        assert.equal(l.cropTool, false, "crop tool closed");
        assert.equal(l.editImage, true, "Edit Image still open");
        assert.equal(await editorCloses(page), 0, "Post Editor not closed");
        assert.deepEqual(actions.slice(sent), [], "no save sent");
        const d = diff(before, await canvasShot(page));
        assert.ok(d < 1.5, `canvas changed: mean diff ${d.toFixed(2)}`);
      });
      if (how === "Escape") {
        await page.keyboard.press("Escape");
        await page.waitForTimeout(500);
        await check(`${tag}: Edit Image -> Escape: ONLY Edit Image closes; the Post Editor stays open`, async () => {
          assert.equal((await layers(page)).editImage, false, "Edit Image closed");
          assert.equal(await editorCloses(page), 0, "Post Editor not closed");
          assert.deepEqual(actions.slice(sent), [], "no save sent");
        });
        await page.keyboard.press("Escape");
        await page.waitForTimeout(400);
        await check(`${tag}: Escape with only the Post Editor open closes it -- exactly once`, async () => {
          assert.equal(await editorCloses(page), 1);
        });
      }
      await ctx.close();
    }
    {
      // the Post Editor's own enlarged Crop overlay (cover menu -> Crop): unchanged
      const { ctx, page, actions } = await open(q);
      const sent = actions.length;
      for (const how of ["Escape", "Cancel"]) {
        await frameMenu(page, "Crop");
        await page.waitForTimeout(400);
        const f = await page.locator("div.fixed[class~='z-[101]'] > div").first().boundingBox();
        await page.mouse.move(f.x + f.width / 2, f.y + f.height / 2);
        await page.mouse.down();
        await page.mouse.move(f.x + f.width / 2 + 40, f.y + f.height / 2, { steps: 5 }); // unapplied
        await page.mouse.up();
        if (how === "Escape") await page.keyboard.press("Escape");
        else await page.locator("div.fixed[class~='z-[101]']").getByRole("button", { name: "Cancel", exact: true }).click();
        await page.waitForTimeout(400);
        await check(`${tag}: Post Editor Crop overlay -> ${how}: only the overlay closes; nothing saved`, async () => {
          assert.equal((await layers(page)).gridCropOverlay, false);
          assert.equal(await editorCloses(page), 0);
          assert.deepEqual(actions.slice(sent).filter((b) => /"scale"/.test(b)), [], "no crop write");
        });
      }
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
      await check(`${tag}: ...then Escape closes the Post Editor exactly once`, async () => {
        assert.equal(await editorCloses(page), 1);
      });
      await ctx.close();
    }
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
  const video = await recordTestVideo(browser);
  await run(browser, video);
  await runCoverVisual("chromium", browser, video);
  await runEditImageEscape("chromium", browser);
  const wk = await webkit.launch();
  try {
    await runCoverVisual("webkit", wk, video);
    await runEditImageEscape("webkit", wk);
  } finally {
    await wk.close().catch(() => {});
  }
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
