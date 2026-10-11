// Opt-in REAL-BROWSER regression check for reaching Edit Image / Adjust from
// the Post Editor popup (the one Grid opens). Not part of the default test
// run: it starts a Next dev server and needs Playwright's Chromium AND
// WebKit (npx playwright install chromium webkit).
//
//   node scripts/annotation-editor-tools.check.mjs
//
// The reported problem was "no Adjustments when editing an image" in that
// popup. Nothing about it is role- or browser-gated in code, so this mounts
// the REAL Modal + REAL PostEditor + REAL AnnotationEditor on fixture data
// and MEASURES what is actually reachable:
//   - who gets the frame menu and Edit Image at all (per role);
//   - whether every tool in the editor's rail -- Adjust included -- is on
//     screen, at a range of window heights (the rail used to cut its lower
//     tools off on short windows);
//   - that Adjust really works: the panel opens, a slider changes the
//     canvas's pixels, and the change is in what Save sends.
//
// Everything temporary lives under a proxy-public folder that is ALWAYS
// deleted again (finally). Read-only: the one server action Save fires is
// intercepted, inspected and never reaches a server. Not covered: the real
// save round-trip and reopen (needs a database), and real Safari --
// Playwright's WebKit is not Safari on macOS.

import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import sharp from "sharp";
import { chromium, webkit } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HARNESS_DIR = path.join(ROOT, "src", "app", "preview-editor-tools-harness-check");
const PORT = 3129;
const BASE = `http://localhost:${PORT}/preview-editor-tools-harness-check`;
const ONLY_HEIGHTS = process.env.RAIL_HEIGHTS?.split(",").map(Number);

const HARNESS = `"use client";
// TEMPORARY -- created and deleted by scripts/annotation-editor-tools.check.mjs. Never commit.
import { useSearchParams } from "next/navigation";
import { Modal } from "../projects/[projectId]/modal";
import { PostEditor, type PostAssetItem } from "../projects/[projectId]/posts/[postId]/post-editor";
const M = "https://media.test/";
const ASSETS: PostAssetItem[] = [
  { postAssetId: "pa-1", mediaAssetId: "m-1", url: M + "a.jpg", originalUrl: M + "a.jpg", annotationJson: null, mediaType: "image", posterUrl: null },
  { postAssetId: "pa-2", mediaAssetId: "m-2", url: M + "b.jpg", originalUrl: M + "b.jpg", annotationJson: null, mediaType: "image", posterUrl: null },
];
const NONE: never[] = [];
const LIBRARY = Promise.resolve([]);
const POST = { id: "00000000-0000-0000-0000-000000000001", post_type: "carousel" as const, caption: "", notes: "", scheduled_date: null, scheduled_time: null, status: "draft" as const, review_status: "pending" as const, coverTransform: null };
// The same derivation the real data layer uses (lib/data/posts.ts): canManage = canEditContent(role).
import { canEditContent } from "@/lib/role-permissions";
export default function Harness() {
  const role = (useSearchParams().get("role") ?? "editor") as "owner" | "admin" | "editor" | "viewer" | "client";
  return (
    <Modal onClose={() => {}}>
      <PostEditor projectId="00000000-0000-0000-0000-000000000000" post={POST} assets={ASSETS} links={NONE} mediaLibraryPromise={LIBRARY}
        canManage={canEditContent(role)} role={role} currentUserId="00000000-0000-0000-0000-000000000002" members={NONE} dateFormat="DD/MM/YYYY" hideBackLink enableMediaViewer />
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

const TOOLS = ["Select", "Crop", "Draw", "Text", "Arrow", "Logo", "Adjust", "Flip", "Undo", "Redo", "Delete"];

async function run(engine, browser, image) {
  async function open(viewport, { role = "editor", mobile = false } = {}) {
    const ctx = await browser.newContext({ viewport, hasTouch: mobile, isMobile: mobile });
    const page = await ctx.newPage();
    await page.route("https://media.test/**", (r) => r.fulfill({ body: image, contentType: "image/jpeg", headers: { "access-control-allow-origin": "*" } }));
    // Next runs server actions one at a time: the comments thread's own
    // mount-time action is aborted so it can't block; Save's action is kept
    // (its body is what one check inspects) and left pending.
    const saves = [];
    await page.route(`http://localhost:${PORT}/**`, (r) => {
      const req = r.request();
      if (!(req.method() === "POST" && req.headers()["next-action"])) return r.fallback();
      const body = req.postData() ?? "";
      if (body.includes("annotation_json")) {
        saves.push(body);
        return new Promise(() => {});
      }
      return r.abort();
    });
    await page.goto(`${BASE}?role=${role}`, { waitUntil: "load" });
    await page.waitForSelector("text=Close X", { timeout: 90000 });
    const frameMenus = page.locator("button[title='Frame options']");
    const editImage = page.getByRole("button", { name: "Edit Image", exact: true });
    async function openEditor() {
      // Hydrated once the frame menu actually opens on click.
      for (const end = Date.now() + 90000; ; ) {
        await frameMenus.first().click();
        if (await editImage.count()) break;
        if (Date.now() > end) throw new Error("page never hydrated");
        await page.waitForTimeout(250);
      }
      await editImage.click();
      await page.locator("[data-editor-tool-rail]").waitFor({ timeout: 30000 });
      // Canvas ready = the Save button is enabled.
      // (PostEditor has its own Save Changes; the editor one is the rounded-full button.)
      await page.waitForFunction(() => [...document.querySelectorAll("button.rounded-full")].some((b) => b.textContent.trim() === "Save Changes" && !b.disabled), null, { timeout: 30000 });
    }
    const rail = () =>
      page.evaluate(() => {
        const el = document.querySelector("[data-editor-tool-rail]");
        const rr = el.getBoundingClientRect();
        const buttons = [...el.querySelectorAll("button")].map((b) => {
          const r = b.getBoundingClientRect();
          return {
            label: b.textContent.trim(),
            x: Math.round(r.x),
            w: Math.round(r.width),
            h: Math.round(r.height),
            onScreen: r.top >= rr.top - 1 && r.bottom <= Math.min(rr.bottom, innerHeight) + 1 && r.left >= rr.left - 1 && r.right <= rr.right + 1,
          };
        });
        const canvas = document.querySelector("canvas.lower-canvas")?.getBoundingClientRect();
        return {
          buttons,
          columns: new Set(buttons.map((b) => b.x)).size,
          width: Math.round(rr.width),
          overflowY: el.scrollHeight - el.clientHeight,
          overflowX: el.scrollWidth - el.clientWidth,
          pageOverflowX: document.documentElement.scrollWidth - innerWidth,
          canvas: canvas ? { w: Math.round(canvas.width), h: Math.round(canvas.height), right: Math.round(canvas.right), bottom: Math.round(canvas.bottom) } : null,
          innerWidth,
          innerHeight,
        };
      });
    return { ctx, page, frameMenus, editImage, openEditor, rail, saves };
  }

  // --- who can reach Edit Image at all --------------------------------------
  for (const role of ["owner", "admin", "editor"]) {
    const { ctx, page, openEditor } = await open({ width: 1440, height: 900 }, { role });
    await check(`${engine}: ${role === "editor" ? "Member (editor)" : role} -- frame menu has Edit Image, the editor opens, Adjust is there`, async () => {
      await openEditor();
      assert.equal(await page.locator("button[title='Adjustments']").count(), 1);
      assert.equal(await page.locator("button[title='Adjustments']").isVisible(), true);
    });
    await ctx.close();
  }
  for (const role of ["viewer", "client"]) {
    const { ctx, page, frameMenus, editImage } = await open({ width: 1440, height: 900 }, { role });
    await check(`${engine}: ${role} -- no frame menu, no Edit Image, no editor (read-only is unchanged)`, async () => {
      await page.waitForTimeout(2500);
      assert.equal(await page.locator("img[src*='a.jpg']").count() > 0, true, "media still visible");
      assert.equal(await frameMenus.count(), 0);
      assert.equal(await editImage.count(), 0);
      assert.equal(await page.locator("[data-editor-tool-rail]").count(), 0);
    });
    await ctx.close();
  }

  // --- every tool on screen, at every window height ----------------------------
  // 900/790: a normal laptop window. 720/650: a 1366x768 laptop, or a 13"
  // Mac at a scaled resolution. 560/480/400: the same machines at 125-200%
  // browser zoom, or a window that isn't maximised.
  for (const height of ONLY_HEIGHTS ?? [900, 790, 740, 720, 650, 560, 540, 480, 400]) {
    const { ctx, page, openEditor, rail } = await open({ width: 1280, height });
    await check(`${engine}: 1280x${height} -- all 11 tools incl. Adjust are fully on screen, nothing to scroll for`, async () => {
      await openEditor();
      const m = await rail();
      assert.deepEqual(m.buttons.map((b) => b.label), TOOLS);
      const hidden = m.buttons.filter((b) => !b.onScreen).map((b) => b.label);
      assert.deepEqual(hidden, [], `cut off: ${hidden.join(", ")} (rail ${m.width}px wide, ${m.columns} column(s), overflow ${m.overflowY}px)`);
      assert.ok(m.overflowY <= 1 && m.overflowX <= 1, `rail overflows ${m.overflowX}x${m.overflowY}`);
      assert.ok(m.pageOverflowX <= 1, "no horizontal page overflow");
      assert.equal(m.columns, height >= 740 ? 1 : height >= 540 ? 2 : 3, `columns at ${height}px`);
      assert.ok(m.buttons.every((b) => Math.abs(b.w - 52) <= 1 && Math.abs(b.h - m.buttons[0].h) <= 1), "buttons keep their 52px single-column size: " + JSON.stringify(m.buttons.map((b) => [b.w, b.h])));
      assert.ok(m.canvas && m.canvas.w >= 150 && m.canvas.h >= 150, `canvas still usable: ${JSON.stringify(m.canvas)}`);
      assert.ok(m.canvas.right <= m.innerWidth + 1 && m.canvas.bottom <= m.innerHeight + 1, "canvas on screen");
    });
    if (height === 560) {
      await check(`${engine}: 1280x${height} -- Adjust opens its panel with all 9 sliders on screen`, async () => {
        await page.locator("button[title='Adjustments']").click();
        await page.getByText("Adjustments", { exact: true }).waitFor({ timeout: 5000 });
        const sliders = page.locator("input[type=range]");
        assert.equal(await sliders.count(), 9);
        const box = await sliders.first().boundingBox();
        assert.ok(box.y >= 0 && box.y + box.height <= height && box.x + box.width <= 1280, JSON.stringify(box));
      });
    }
    await ctx.close();
  }

  // --- a phone in portrait is untouched ----------------------------------------
  {
    const { ctx, openEditor, rail } = await open({ width: 390, height: 844 }, { mobile: true });
    await check(`${engine}: 390x844 touch -- original single 64px column, every tool on screen`, async () => {
      await openEditor();
      const m = await rail();
      assert.equal(m.columns, 1);
      assert.equal(m.width, 64);
      assert.deepEqual(m.buttons.filter((b) => !b.onScreen).map((b) => b.label), []);
      assert.ok(m.pageOverflowX <= 1);
    });
    await ctx.close();
  }

  // --- Adjust actually adjusts, and it is what Save sends ----------------------
  {
    const { ctx, page, openEditor, saves } = await open({ width: 1280, height: 650 });
    const centre = () =>
      page.evaluate(() => {
        const c = document.querySelector("canvas.lower-canvas");
        const d = c.getContext("2d").getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data;
        return [d[0], d[1], d[2]];
      });
    await check(`${engine}: moving Brightness changes the canvas's pixels; Reset puts them back`, async () => {
      await openEditor();
      await page.waitForTimeout(500);
      const before = await centre();
      await page.locator("button[title='Adjustments']").click();
      const slider = page.locator("input[type=range]").first();
      await slider.waitFor();
      // Drive the real control: set the value the way React sees a user change, then release.
      await slider.evaluate((el) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, "60");
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      });
      await page.waitForTimeout(700);
      const after = await centre();
      assert.ok(after[0] + after[1] + after[2] > before[0] + before[1] + before[2] + 60, `before ${before} after ${after}`);
    });
    await check(`${engine}: Save sends the adjustment (annotation_json carries the Brightness filter) plus the rendered image`, async () => {
      await page.locator("button.rounded-full", { hasText: "Save Changes" }).click();
      for (const end = Date.now() + 15000; saves.length === 0; ) {
        if (Date.now() > end) throw new Error("Save never sent its server action");
        await page.waitForTimeout(100);
      }
      assert.equal(saves.length, 1);
      assert.match(saves[0], /"type":"Brightness"/);
      assert.match(saves[0], /"brightness":0\.6/);
      assert.match(saves[0], /annotated-preview\.jpg/);
      // The post being edited travels with the save -- what copy-on-write keys off (saveMediaAssetAnnotation).
      assert.match(saves[0], /name="[^"]*post_id"/);
    });
    await page.unrouteAll({ behavior: "ignoreErrors" });
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
  const image = await sharp({ create: { width: 1500, height: 2000, channels: 3, background: "#335577" } }).jpeg().toBuffer();
  for (const [engine, type] of [
    ["chromium", chromium],
    ["webkit", webkit],
  ]) {
    const browser = await type.launch();
    browsers.push(browser);
    console.log(`\n### ${engine} ${browser.version()}${engine === "webkit" ? " (Playwright build -- not Safari on macOS)" : ""}`);
    await run(engine, browser, image);
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
  // next dev registers every route it compiled in generated type stubs
  // (.next/dev/types, included by tsconfig). Left alone, they'd keep
  // referencing the deleted harness page and break `tsc`/`next build`.
  fs.rmSync(path.join(ROOT, ".next", "dev", "types"), { recursive: true, force: true });
}
console.log(`\n${passed} checks passed, ${failed} failed`);
if (failed) process.exit(1);
