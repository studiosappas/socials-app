// Opt-in MEASURED check for Edit Image / Edit Cover's Crop and saved-edit
// restore (AnnotationEditor), in a real browser. Not part of the default
// test run: it starts a Next dev server and needs Playwright's Chromium.
//
//   node scripts/annotation-crop.check.mjs
//
// A TEMPORARY page renders the REAL AnnotationEditor on a fixture photo
// whose four quadrants are solid colours, with a stub saveAction that keeps
// the saved annotation_json + JPEG in the page. Checks:
//   A. entering Crop does not resize the canvas (toolbar lives in the header)
//   B. re-entering Crop opens on the CURRENT framing (same zoom/offset the
//      user applied), and an immediate Apply changes no pixels
//   C. a saved edit reopened in a different-sized window shows the same
//      picture (objects rescaled to the saved frame), at the saved aspect
//   D. a legacy 3:4 save reopened where the target is 4:5 keeps its 3:4
//      frame and framing (never recropped), and still saves 3:4
//
// Everything temporary lives under one folder that is ALWAYS deleted
// (finally). Playwright's Chromium is not Safari / a real phone.

import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import sharp from "sharp";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HARNESS_DIR = path.join(ROOT, "src", "app", "preview-annotation-crop-harness-check");
const PORT = 3128;
const BASE = `http://localhost:${PORT}/preview-annotation-crop-harness-check`;

const HARNESS = `"use client";
// TEMPORARY -- created and deleted by scripts/annotation-crop.check.mjs. Never commit.
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AnnotationEditor } from "@/components/annotation-editor";
declare global {
  interface Window { __saves: { json: string; previewUrl: string }[] }
}
const ASPECTS: Record<string, { w: number; h: number }> = { "34": { w: 3, h: 4 }, "45": { w: 4, h: 5 }, "916": { w: 9, h: 16 } };
async function saveAction(_projectId: string, _id: string, formData: FormData) {
  const file = formData.get("file") as File;
  const previewUrl = URL.createObjectURL(file);
  window.__saves = window.__saves ?? [];
  window.__saves.push({ json: String(formData.get("annotation_json")), previewUrl });
  return { previewUrl };
}
function Editor() {
  const params = useSearchParams();
  const aspect = ASPECTS[params.get("aspect") ?? "45"];
  const restore = params.get("restore");
  const initial = restore ? JSON.parse(atob(restore)) : null;
  return (
    <AnnotationEditor projectId="p" attachmentId="a" postId="q" open imageUrl="https://media.test/photo.png"
      initialAnnotationJson={initial} mediaType="image" targetAspect={aspect}
      onClose={() => {}} onSaved={() => {}} saveAction={saveAction} />
  );
}
export default function Harness() {
  return <Suspense fallback={null}><Editor /></Suspense>;
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

// 2000x1500 landscape: red | green over blue | yellow, with a black square
// off-centre so any shift of the window is visible in the pixels.
async function fixturePhoto() {
  const q = (color) => sharp({ create: { width: 1000, height: 750, channels: 3, background: color } }).png().toBuffer();
  const [r, g, b, y] = await Promise.all([q("#e03030"), q("#30c040"), q("#3050e0"), q("#f0d020")]);
  const dot = await sharp({ create: { width: 160, height: 160, channels: 3, background: "#000000" } }).png().toBuffer();
  return sharp({ create: { width: 2000, height: 1500, channels: 3, background: "#ffffff" } })
    .composite([
      { input: r, left: 0, top: 0 },
      { input: g, left: 1000, top: 0 },
      { input: b, left: 0, top: 750 },
      { input: y, left: 1000, top: 750 },
      { input: dot, left: 1240, top: 420 },
    ])
    .png()
    .toBuffer();
}

// Mean absolute per-channel difference (0-255) between two images after
// both are resized to the same small grid -- shape-independent of the
// on-screen size, which is exactly what differs between windows.
async function meanDiff(a, b, w = 48, h = 60) {
  const [ra, rb] = await Promise.all(
    [a, b].map((buf) => sharp(buf).removeAlpha().resize(w, h, { fit: "fill" }).raw().toBuffer()),
  );
  let sum = 0;
  for (let i = 0; i < ra.length; i++) sum += Math.abs(ra[i] - rb[i]);
  return sum / ra.length;
}

async function run(browser, photo) {
  async function open(viewport, query = "") {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    await page.route("https://media.test/**", (r) => r.fulfill({ body: photo, contentType: "image/png" }));
    await page.goto(BASE + query, { waitUntil: "networkidle" });
    // ready = Fabric's container exists and the loading overlay is hidden
    await page.locator(".canvas-container").waitFor({ timeout: 30000 });
    await page.waitForFunction(() => {
      const el = [...document.querySelectorAll("p")].find((p) => p.textContent === "Loading image…");
      return el && getComputedStyle(el.parentElement).display === "none";
    }, null, { timeout: 30000 });
    await page.waitForTimeout(300);
    return { ctx, page };
  }
  const box = (page) => page.locator(".canvas-container").evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { w: r.width, h: r.height, x: r.x, y: r.y };
  });
  const shot = (page) => page.locator(".canvas-container").screenshot();
  const overlayImg = (page) => page.locator("div.absolute.z-10.bg-background div.overflow-hidden img").first();
  const overlayTransform = (page) => overlayImg(page).evaluate((el) => {
    const t = getComputedStyle(el).transform; // matrix(a, b, c, d, e, f)
    const m = t.match(/matrix\(([^)]+)\)/);
    const [a, , , , e, f] = m ? m[1].split(",").map(Number) : [1, 0, 0, 1, 0, 0];
    return { scale: a, tx: e, ty: f };
  });
  const sidebar = (page, label) => page.locator(`button[title='${label}']`).first();
  async function enterCrop(page) {
    await sidebar(page, "Crop Image").click();
    await page.getByRole("button", { name: "Apply crop" }).waitFor();
    await page.waitForTimeout(250); // the frame is measured after two animation frames
  }
  async function applyCrop(page) {
    await page.getByRole("button", { name: "Apply crop" }).click();
    await page.getByRole("button", { name: "Apply crop" }).waitFor({ state: "detached", timeout: 15000 });
    await page.waitForTimeout(300);
  }
  async function save(page) {
    const before = await page.evaluate(() => (window.__saves ?? []).length);
    await page.getByRole("button", { name: "Save Changes" }).click();
    await page.waitForFunction((n) => (window.__saves ?? []).length > n, before, { timeout: 30000 });
    const s = await page.evaluate(() => window.__saves[window.__saves.length - 1]);
    const jpeg = Buffer.from(
      await page.evaluate(async (url) => {
        const buf = await (await fetch(url)).arrayBuffer();
        let str = "";
        for (const byte of new Uint8Array(buf)) str += String.fromCharCode(byte);
        return btoa(str);
      }, s.previewUrl),
      "base64",
    );
    return { json: s.json, jpeg };
  }
  const restoreQuery = (json, aspect) => `?aspect=${aspect}&restore=${encodeURIComponent(Buffer.from(json).toString("base64"))}`;

  // --- A + B: one session at 4:5 -------------------------------------------
  const { ctx, page } = await open({ width: 1280, height: 900 }, "?aspect=45");
  const initialBox = await box(page);
  await check("A. the 4:5 target builds a 4:5 canvas", async () => {
    assert.ok(Math.abs(initialBox.w / initialBox.h - 0.8) < 0.01, JSON.stringify(initialBox));
  });
  await enterCrop(page);
  await check("A. entering Crop does NOT resize or move the canvas", async () => {
    const b = await box(page);
    assert.ok(Math.abs(b.w - initialBox.w) < 0.5 && Math.abs(b.h - initialBox.h) < 0.5, `${JSON.stringify(initialBox)} -> ${JSON.stringify(b)}`);
    assert.ok(Math.abs(b.y - initialBox.y) < 0.5, `moved vertically ${initialBox.y} -> ${b.y}`);
  });

  // zoom in with the bottom-right corner handle, then pan the image
  const frame = await page.locator("div.absolute.z-10.bg-background").boundingBox();
  const corner = { x: frame.x + frame.width - 2, y: frame.y + frame.height - 2 };
  await page.mouse.move(corner.x, corner.y);
  await page.mouse.down();
  await page.mouse.move(corner.x + 70, corner.y + 70, { steps: 8 });
  await page.mouse.up();
  const centre = { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  await page.mouse.move(centre.x - 45, centre.y + 30, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  const chosen = await overlayTransform(page);
  await check("B. (setup) the crop gesture actually zoomed and panned", async () => {
    assert.ok(chosen.scale > 1.05, JSON.stringify(chosen));
    assert.ok(Math.abs(chosen.tx) > 5 || Math.abs(chosen.ty) > 5, JSON.stringify(chosen));
  });
  await applyCrop(page);
  const afterApply = await shot(page);
  await enterCrop(page);
  const reopened = await overlayTransform(page);
  await check("B. re-entering Crop opens on the APPLIED framing -- same zoom and offset, not the full image at zoom 1", async () => {
    assert.ok(Math.abs(reopened.scale - chosen.scale) < 0.01, `scale ${chosen.scale} -> ${reopened.scale}`);
    assert.ok(Math.abs(reopened.tx - chosen.tx) < 1 && Math.abs(reopened.ty - chosen.ty) < 1, `${JSON.stringify(chosen)} -> ${JSON.stringify(reopened)}`);
  });
  await check("B. re-entering Crop still does not resize the canvas", async () => {
    const b = await box(page);
    assert.ok(Math.abs(b.w - initialBox.w) < 0.5 && Math.abs(b.h - initialBox.h) < 0.5);
  });
  await applyCrop(page);
  await check("B. an immediate Apply after re-entering changes no pixels (the saved crop is kept)", async () => {
    const d = await meanDiff(afterApply, await shot(page));
    assert.ok(d < 1.5, `mean diff ${d.toFixed(2)}`);
  });
  // an arrow, so object placement is part of what has to survive a reopen
  await sidebar(page, "Arrows").click();
  await page.mouse.click(5, 5); // deselect, so no selection chrome is in the screenshots
  await page.waitForTimeout(200);
  const savedLook = await shot(page);
  const saved45 = await save(page);
  await check("save: the 4:5 edit exports a 4:5 JPEG at >= 1080 wide", async () => {
    const m = await sharp(saved45.jpeg).metadata();
    assert.ok(Math.abs(m.width / m.height - 0.8) < 0.005 && m.width >= 1080, `${m.width}x${m.height}`);
  });
  await ctx.close();

  // --- C: reopen in a different-sized window -------------------------------
  for (const viewport of [{ width: 820, height: 700 }, { width: 1600, height: 1000 }]) {
    const r = await open(viewport, restoreQuery(saved45.json, "45"));
    await check(`C. reopened at ${viewport.width}x${viewport.height}: same picture as when saved (photo, crop, arrow), 4:5`, async () => {
      const b = await box(r.page);
      assert.ok(Math.abs(b.w / b.h - 0.8) < 0.01, JSON.stringify(b));
      const d = await meanDiff(savedLook, await shot(r.page));
      assert.ok(d < 6, `mean diff ${d.toFixed(2)}`);
    });
    await enterCrop(r.page);
    await check(`C. reopened at ${viewport.width}x${viewport.height}: Crop opens on the saved framing`, async () => {
      const t = await overlayTransform(r.page);
      // offsets are in screen px of a differently-sized frame: compare as a fraction of the frame
      const f = await r.page.locator("div.absolute.z-10.bg-background").boundingBox();
      assert.ok(Math.abs(t.scale - chosen.scale) < 0.02, `scale ${chosen.scale} -> ${t.scale}`);
      assert.ok(Math.abs(t.tx / f.width - chosen.tx / frame.width) < 0.01 && Math.abs(t.ty / f.height - chosen.ty / frame.height) < 0.01,
        `${JSON.stringify(chosen)} @${frame.width} -> ${JSON.stringify(t)} @${f.width}`);
    });
    await r.ctx.close();
  }

  // --- D: a legacy 3:4 save reopened where new edits are 4:5 ---------------
  const legacy = await open({ width: 1280, height: 900 }, "?aspect=34");
  await legacy.page.mouse.click(5, 5);
  const legacyLook = await shot(legacy.page);
  const saved34 = await save(legacy.page);
  await legacy.ctx.close();
  const reopened34 = await open({ width: 1100, height: 820 }, restoreQuery(saved34.json, "45"));
  await check("D. a 3:4 edit reopened with a 4:5 target KEEPS its 3:4 frame and framing", async () => {
    const b = await box(reopened34.page);
    assert.ok(Math.abs(b.w / b.h - 0.75) < 0.01, `aspect ${(b.w / b.h).toFixed(4)}`);
    const d = await meanDiff(legacyLook, await shot(reopened34.page));
    assert.ok(d < 6, `mean diff ${d.toFixed(2)}`);
  });
  await check("D. re-saving it still exports 3:4 -- nothing recropped", async () => {
    const m = await sharp((await save(reopened34.page)).jpeg).metadata();
    assert.ok(Math.abs(m.width / m.height - 0.75) < 0.005, `${m.width}x${m.height}`);
  });
  await reopened34.ctx.close();
}

let server;
try {
  fs.mkdirSync(HARNESS_DIR, { recursive: true });
  fs.writeFileSync(path.join(HARNESS_DIR, "page.tsx"), HARNESS);
  server = spawn(`npx next dev --port ${PORT}`, { cwd: ROOT, shell: true, stdio: "ignore" });
  await waitForServer(BASE, 180000);
  const photo = await fixturePhoto();
  const browser = await chromium.launch();
  try {
    console.log(`### AnnotationEditor crop/restore -- chromium ${browser.version()}`);
    await run(browser, photo);
  } finally {
    await browser.close();
  }
} finally {
  if (server?.pid) {
    try {
      if (process.platform === "win32") execSync(`taskkill /pid ${server.pid} /T /F`, { stdio: "ignore" });
      else process.kill(-server.pid);
    } catch {
      // already gone
    }
  }
  fs.rmSync(HARNESS_DIR, { recursive: true, force: true });
  // Same as scripts/post-export.check.mjs: next dev's generated route type
  // stubs would keep referencing the deleted harness and break tsc/build.
  fs.rmSync(path.join(ROOT, ".next", "dev", "types"), { recursive: true, force: true });
}
console.log(`\n${passed} checks passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
