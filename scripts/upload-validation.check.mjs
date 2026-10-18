// Opt-in MEASURED check for site-wide upload validation. Not part of the
// default test run: it starts a Next dev server and needs Playwright's
// Chromium AND WebKit (npx playwright install chromium webkit).
//
//   node scripts/upload-validation.check.mjs
//
// Runs the REAL code in real browser engines, on files built in the page:
//  A. probeVideoFile -- a playable video decodes; an AVI the browser can't
//     play is "unsupported"; a timeout is "undetermined", never "unsupported".
//  B. uploadFilesAndSummarize (the shared helper behind Post Editor and
//     Content uploads) on a mixed batch -- which files reach storage, which
//     are named in the one summary message, and that a network failure is
//     reported as a network failure, not a bad file.
//  C. The real AnnotationEditor (Edit Cover) on a video the browser can't
//     play -- the frame picker and the reopen path both explain it.
//  D. Grid media library: a failed upload shows ONE notification -- the
//     toast, no red inline copy -- in the sidebar and above the
//     Choose-from-library dialog.
//  E. Brief: a recognised video container the browser can't play is kept as
//     a reference attachment (preview unavailable + Download); a non-video
//     named like one is rejected; Grid / Post Editor / Content stay strict.
//
// NOTHING leaves the machine: every request to a Supabase host is answered
// by this script (storage uploads are recorded, never forwarded), and any
// other non-localhost request is aborted and counted as a failure. Real
// Safari / a real phone are not covered -- Playwright's WebKit is not Safari.

import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import os from "node:os";
import sharp from "sharp";
import { chromium, webkit } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HARNESS_DIR = path.join(ROOT, "src", "app", "preview-upload-validation-harness-check");
const PORT = 3128;
const BASE = `http://localhost:${PORT}/preview-upload-validation-harness-check`;

const HELPERS_PAGE = `"use client";
// TEMPORARY -- created and deleted by scripts/upload-validation.check.mjs. Never commit.
import { useEffect } from "react";
import { probeVideoFile, uploadFilesAndSummarize } from "@/lib/video-poster";
export default function Page() {
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__probe = async (file: File, timeoutMs?: number) => {
      const r = await probeVideoFile(file, timeoutMs ? { timeoutMs } : undefined);
      return { status: r.status, posterBytes: r.status === "decoded" ? r.poster.size : 0 };
    };
    w.__upload = async (files: File[], context: "media" | "content") => {
      const actions: string[] = [];
      const summary = await uploadFilesAndSummarize(
        "00000000-0000-0000-0000-000000000000",
        (fd: FormData) => void actions.push(String(fd.get("fileName")) + ":" + String(fd.get("mediaType")) + ":" + (fd.get("poster") ? "poster" : "no-poster")),
        files,
        context,
      );
      return { summary, actions };
    };
    document.body.dataset.ready = "1";
  }, []);
  return <p>upload validation harness</p>;
}
`;

const EDITOR_PAGE = `"use client";
// TEMPORARY -- created and deleted by scripts/upload-validation.check.mjs. Never commit.
import { useSearchParams } from "next/navigation";
import { AnnotationEditor } from "@/components/annotation-editor";
export default function Page() {
  const params = useSearchParams();
  const src = params.get("src") ?? "https://media.test/bad.avi";
  const reopen = params.get("reopen") === "1";
  return (
    <AnnotationEditor
      projectId="00000000-0000-0000-0000-000000000000"
      attachmentId="m-1"
      open
      imageUrl={src}
      initialAnnotationJson={reopen ? { version: "7", objects: [] } : null}
      mediaType="video"
      targetAspect={{ w: 3, h: 4 }}
      onClose={() => {}}
      onSaved={() => {}}
      saveAction={async () => ({ previewUrl: "x" })}
    />
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

// An AVI-shaped file no browser can decode (RIFF/AVI header + junk), like
// the Motion-JPEG AVI from the real report.
function fakeAviBytes() {
  const b = Buffer.alloc(64 * 1024);
  b.write("RIFF", 0, "latin1");
  b.writeUInt32LE(b.length - 8, 4);
  b.write("AVI LIST", 8, "latin1");
  for (let i = 16; i < b.length; i++) b[i] = (i * 37 + 11) % 256;
  return b;
}

// Records a short video in THIS engine with a format THIS engine can record
// (WebM in Chromium) -- i.e. a genuinely playable file. Returns null when the
// engine has no MediaRecorder (Playwright's Windows WebKit).
async function recordPlayableVideo(page) {
  return page.evaluate(async () => {
    if (typeof MediaRecorder === "undefined") return null;
    const type = ["video/webm;codecs=vp8", "video/webm", "video/mp4"].find((t) => MediaRecorder.isTypeSupported(t));
    if (!type) return null;
    const c = Object.assign(document.createElement("canvas"), { width: 160, height: 120 });
    const ctx = c.getContext("2d");
    const rec = new MediaRecorder(c.captureStream(30), { mimeType: type });
    const chunks = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.start(100);
    const t0 = performance.now();
    await new Promise((done) => {
      (function frame() {
        const t = performance.now() - t0;
        ctx.fillStyle = `hsl(${(t / 5) % 360} 60% 45%)`;
        ctx.fillRect(0, 0, 160, 120);
        if (t < 1200) requestAnimationFrame(frame);
        else done();
      })();
    });
    rec.stop();
    await new Promise((r) => (rec.onstop = r));
    const blob = new Blob(chunks, { type: type.split(";")[0] });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = "";
    for (const byte of buf) s += String.fromCharCode(byte);
    return { b64: btoa(s), type: type.split(";")[0] };
  });
}

async function newIsolatedPage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const storageUploads = [];
  const escaped = [];
  let storageMode = "ok";
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    // blob:/data: are the page's own in-memory files (WebKit routes them too)
    if (url.protocol === "blob:" || url.protocol === "data:") return route.fallback();
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return route.fallback();
    if (url.hostname.endsWith(".supabase.co")) {
      if (url.pathname.includes("/storage/v1/object/")) {
        storageUploads.push(decodeURIComponent(url.pathname.split("/storage/v1/object/")[1] ?? ""));
        if (storageMode === "network-fail") return route.abort("failed");
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ Key: "x", Id: "y" }) });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    }
    if (url.hostname === "media.test") return route.fallback();
    escaped.push(url.href);
    return route.abort();
  });
  return { ctx, page, storageUploads, escaped, setStorageMode: (m) => (storageMode = m) };
}

let skipped = 0;
// The first engine's recording, reused when an engine can't record its own.
let sharedVideo = null;

async function partAB(engine, browser) {
  console.log(`\n### A+B. decode check and shared upload helper -- ${engine} ${browser.version()}`);
  const { ctx, page, storageUploads, escaped, setStorageMode } = await newIsolatedPage(browser);
  await page.goto(`${BASE}/helpers`, { waitUntil: "load" });
  await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 120000 });
  let video = await recordPlayableVideo(page);
  if (video) sharedVideo ??= video;
  else if (sharedVideo) {
    // No MediaRecorder here: try the other engine's recording, but only
    // count it as "playable" if this engine says it can play that type.
    // Independent of the code under test: a plain <video> either reaches
    // "loadeddata" with a picture, or it doesn't.
    const playable = await page.evaluate(
      ({ b64, type }) =>
        new Promise((resolve) => {
          const v = document.createElement("video");
          v.muted = true;
          const url = URL.createObjectURL(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type }));
          const done = (ok) => {
            URL.revokeObjectURL(url);
            resolve(ok);
          };
          v.onloadeddata = () => done(v.videoWidth > 0);
          v.onerror = () => done(false);
          setTimeout(() => done(false), 10000);
          v.src = url;
        }),
      sharedVideo,
    );
    if (playable) video = sharedVideo;
    console.log(`   no MediaRecorder in ${engine}; reusing the ${sharedVideo.type} recording: plays here = ${playable}`);
  }
  const hasPlayable = Boolean(video);
  const checkPlayable = async (name, fn) => {
    if (hasPlayable) return check(name, fn);
    skipped++;
    console.log(`SKIP - ${name} (no video this engine can both create and play)`);
  };
  const avi = fakeAviBytes().toString("base64");

  // Builds the test files inside the page (real File objects).
  await page.evaluate(
    async ({ video, avi }) => {
      const fromB64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const png = await new Promise((r) => {
        const c = Object.assign(document.createElement("canvas"), { width: 64, height: 48 });
        c.getContext("2d").fillRect(0, 0, 64, 48);
        c.toBlob(r, "image/png");
      });
      window.__files = {
        video: video ? new File([fromB64(video.b64)], video.type === "video/mp4" ? "clip.mp4" : "clip.webm", { type: video.type }) : null,
        avi: new File([fromB64(avi)], "holiday.avi", { type: "video/x-msvideo" }),
        png: new File([png], "photo.png", { type: "image/png" }),
        zip: new File([new Uint8Array([0x50, 0x4b, 3, 4, 0, 0])], "notes.zip", { type: "application/zip" }),
        big: new File([new Uint8Array(50 * 1024 * 1024 + 1)], "huge.png", { type: "image/png" }),
      };
    },
    { video, avi },
  );

  await checkPlayable(`${engine}: a playable video (recorded here as ${video?.type ?? "n/a"}) decodes, with a poster frame`, async () => {
    assert.ok(video, "this engine can't record any video format");
    const r = await page.evaluate(() => window.__probe(window.__files.video));
    assert.equal(r.status, "decoded", JSON.stringify(r));
    assert.ok(r.posterBytes > 0);
  });
  await check(`${engine}: an AVI the browser can't play is definitely "unsupported"`, async () => {
    const r = await page.evaluate(() => window.__probe(window.__files.avi));
    assert.equal(r.status, "unsupported", JSON.stringify(r));
  });
  await checkPlayable(`${engine}: a decode that times out is "undetermined" -- never "unsupported"`, async () => {
    const r = await page.evaluate(() => window.__probe(window.__files.video, 1));
    assert.equal(r.status, "undetermined", JSON.stringify(r));
  });

  await checkPlayable(`${engine}: mixed batch -- valid files upload, the AVI never reaches storage, every rejected file is named`, async () => {
    storageUploads.length = 0;
    const r = await page.evaluate(() =>
      window.__upload([window.__files.png, window.__files.avi, window.__files.zip, window.__files.big, window.__files.video], "media"),
    );
    // main files only -- the image's generated thumbnail is a separate small
    // JPEG upload under a random name (the video's poster travels in the
    // save request, not to storage)
    const mainUploads = storageUploads.filter((p) => !p.endsWith(".jpg"));
    assert.equal(mainUploads.length, 2, `uploaded: ${JSON.stringify(storageUploads)}`);
    assert.ok(mainUploads.every((p) => !p.endsWith(".avi") && !p.endsWith(".zip")), JSON.stringify(mainUploads));
    assert.deepEqual(
      r.actions.map((a) => a.split(":").slice(0, 2).join(":")),
      ["photo.png:image", `${video.type === "video/mp4" ? "clip.mp4" : "clip.webm"}:video`],
    );
    assert.ok(r.actions[1].endsWith(":poster"), "the decoded frame is reused as the video's poster");
    assert.equal(
      r.summary,
      "3 files weren't uploaded: holiday.avi (unsupported video format), notes.zip (unsupported file type), huge.png (too large, max 50 MB). " +
        "Please convert videos to MP4 (H.264). Only images and videos can be uploaded here.",
    );
  });

  await check(`${engine}: batch without any video -- valid image uploads, the AVI, ZIP and oversize file are named`, async () => {
    storageUploads.length = 0;
    const r = await page.evaluate(() =>
      window.__upload([window.__files.png, window.__files.avi, window.__files.zip, window.__files.big], "media"),
    );
    assert.deepEqual(storageUploads.filter((p) => !p.endsWith(".jpg")).map((p) => p.split(".").pop()), ["png"]);
    assert.deepEqual(r.actions.map((a) => a.split(":").slice(0, 2).join(":")), ["photo.png:image"]);
    assert.equal(
      r.summary,
      "3 files weren't uploaded: holiday.avi (unsupported video format), notes.zip (unsupported file type), huge.png (too large, max 50 MB). " +
        "Please convert videos to MP4 (H.264). Only images and videos can be uploaded here.",
    );
  });

  await check(`${engine}: a single unplayable video gets the full, actionable message`, async () => {
    storageUploads.length = 0;
    const r = await page.evaluate(() => window.__upload([window.__files.avi], "media"));
    assert.equal(storageUploads.length, 0);
    assert.equal(
      r.summary,
      `"holiday.avi" wasn't uploaded. Unsupported video format — This video can't be played in your browser. Please convert it to MP4 (H.264) and try again.`,
    );
  });

  await check(`${engine}: a network failure is reported as a network failure, not as a bad file`, async () => {
    setStorageMode("network-fail");
    try {
      const r = await page.evaluate(() => window.__upload([window.__files.png], "media"));
      assert.equal(
        r.summary,
        `"photo.png" wasn't uploaded. Upload failed — The file couldn't be uploaded. Check your internet connection and try again.`,
      );
      assert.deepEqual(r.actions, [], "nothing saved after a failed upload");
    } finally {
      setStorageMode("ok");
    }
  });

  await check(`${engine}: nothing left the machine`, async () => {
    assert.deepEqual(escaped, []);
  });
  await ctx.close();
}

async function partC(engine, browser) {
  console.log(`\n### C. Edit Cover on a stored video the browser can't play -- ${engine}`);
  const bad = fakeAviBytes();
  const expected = "Video can't be played — This video can't be played in your browser, so a frame can't be captured from it.";
  for (const [label, query] of [
    ["frame picker (first Edit Cover)", ""],
    ["reopening a saved cover", "?reopen=1"],
  ]) {
    const { ctx, page, escaped } = await newIsolatedPage(browser);
    await page.route("https://media.test/**", (r) =>
      r.fulfill({ body: bad, contentType: "video/x-msvideo", headers: { "access-control-allow-origin": "*" } }),
    );
    await check(`${engine}: ${label} explains the video can't be played (no silent dead end)`, async () => {
      await page.goto(`${BASE}/editor${query}`, { waitUntil: "load" });
      const message = page.getByText(expected, { exact: false });
      try {
        await message.first().waitFor({ timeout: 90000 });
      } catch (e) {
        const shown = await page.locator(".text-error, [role=alert]").allInnerTexts();
        const video = await page.evaluate(() => {
          const v = document.querySelector("video");
          return v ? { src: v.currentSrc, error: v.error?.code ?? null, readyState: v.readyState, networkState: v.networkState } : null;
        });
        throw new Error(`${e.message.split("\n")[0]} | errors shown: ${JSON.stringify(shown)} | video: ${JSON.stringify(video)}`);
      }
      assert.match(await message.first().innerText(), /MP4 \(H\.264\)/);
      if (!query) assert.equal(await page.getByRole("button", { name: "Use This Frame" }).isDisabled(), true);
      else assert.equal(await page.getByText("Loading…", { exact: true }).count(), 0);
      assert.deepEqual(escaped, []);
    });
    await ctx.close();
  }
}

// --- D. Grid media library: ONE notification (the toast) per failed upload --
// The sidebar uses the real MediaLibrary. The "Choose from library" dialog
// (grid-board.tsx's MediaPickerDialog, not exported) is reproduced from the
// same real parts it is built on -- the shared Dialog, the shared upload
// hook and the app's toast -- which is what decides whether the toast shows
// above it. Only files rejected BEFORE upload are used, and every Server
// Action request is aborted, so the local dev server never talks to any
// real Supabase project.
const LIBRARY_PAGE = `"use client";
// TEMPORARY -- created and deleted by scripts/upload-validation.check.mjs. Never commit.
import { MediaLibrary } from "@/app/projects/[projectId]/grid/media-library";
const NO_ITEMS: never[] = [];
export default function Page() {
  return (
    <div style={{ width: 360, height: 700 }}>
      <MediaLibrary projectId="00000000-0000-0000-0000-000000000000" items={NO_ITEMS} folders={NO_ITEMS} pushCommand={() => {}} />
    </div>
  );
}
`;

const DIALOG_PAGE = `"use client";
// TEMPORARY -- created and deleted by scripts/upload-validation.check.mjs. Never commit.
import { Dialog } from "@/components/ui/dialog";
import { useLibraryItems } from "@/app/projects/[projectId]/grid/use-library-items";
const NO_ITEMS: never[] = [];
export default function Page() {
  const library = useLibraryItems("00000000-0000-0000-0000-000000000000", NO_ITEMS, () => {}, false);
  return (
    <Dialog open onClose={() => {}} title="Choose from library" radius="none">
      <input
        type="file"
        multiple
        data-picker-input=""
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          library.uploadFiles(files);
        }}
      />
      <p>Upload New Asset</p>
    </Dialog>
  );
}
`;

async function partD(engine, browser) {
  console.log(`\n### D. Grid media library -- one upload-error notification (the toast) -- ${engine}`);
  // Playwright only accepts in-memory files up to 50 MB, so the oversize one
  // is a real temporary file (deleted at the end of the run).
  // (Playwright can't mix on-disk and in-memory files in one selection, so
  // all three are temporary files.)
  const big = path.join(OVERSIZE_DIR, "huge.png");
  const zip = path.join(OVERSIZE_DIR, "notes.zip");
  const avi = path.join(OVERSIZE_DIR, "holiday.avi");
  if (!fs.existsSync(big)) fs.writeFileSync(big, Buffer.alloc(50 * 1024 * 1024 + 1));
  if (!fs.existsSync(zip)) fs.writeFileSync(zip, Buffer.from([0x50, 0x4b, 3, 4]));
  if (!fs.existsSync(avi)) fs.writeFileSync(avi, fakeAviBytes());
  const expectedOne = `"huge.png" wasn't uploaded. File too large — The maximum file size here is 50 MB.`;
  const expectedMany =
    "2 files weren't uploaded: notes.zip (unsupported file type), huge.png (too large, max 50 MB). Only images and videos can be uploaded here.";

  async function setup(pagePath) {
    const iso = await newIsolatedPage(browser);
    const actions = [];
    // Belt and braces: no Server Action may reach the dev server.
    await iso.page.route(`http://localhost:${PORT}/**`, (r) =>
      r.request().method() === "POST" && r.request().headers()["next-action"] ? (actions.push(r.request().url()), r.abort()) : r.fallback(),
    );
    await iso.page.goto(`${BASE}/${pagePath}`, { waitUntil: "load" });
    return { ...iso, actions };
  }
  // Exactly where the toast is drawn, the topmost element must be the toast
  // itself (not the dialog's overlay or panel).
  async function toastState(page, text) {
    const toast = page.getByRole("status").filter({ hasText: text });
    await toast.first().waitFor({ timeout: 60000 });
    // let its entrance animation (animate-settle-in) finish before sampling
    await page.waitForTimeout(700);
    // The toast is pointer-events:none by design (it must never block a
    // click), and elementFromPoint SKIPS such elements -- so for this
    // measurement only, the toast briefly takes pointer events, then gets
    // its own styles back. What's measured is paint order, not clickability.
    const state = await page.evaluate((t) => {
      const el = [...document.querySelectorAll('[role="status"]')].find((n) => n.textContent === t);
      if (!el) return { found: false };
      const r = el.getBoundingClientRect();
      const chain = [el, el.parentElement].filter(Boolean);
      const saved = chain.map((n) => n.style.pointerEvents);
      chain.forEach((n) => (n.style.pointerEvents = "auto"));
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      chain.forEach((n, i) => (n.style.pointerEvents = saved[i]));
      const style = getComputedStyle(el);
      return {
        found: true,
        onTop: Boolean(top && (top === el || el.contains(top))),
        visible: r.width > 0 && r.height > 0 && style.visibility !== "hidden" && Number(style.opacity) > 0,
        inViewport: r.top >= 0 && r.bottom <= window.innerHeight,
        inlineErrorCopies: [...document.querySelectorAll(".text-error")].filter((n) => n.textContent?.includes(t.slice(0, 20))).length,
        totalCopies: [...document.querySelectorAll("body *")].filter((n) => n.children.length === 0 && n.textContent === t).length,
        box: { x: r.left, y: r.top, w: r.width, h: r.height },
        // The browser's own conversion of the toast's colour (Tailwind v4
        // computes oklch()) to plain RGB, via a canvas.
        bg: (() => {
          const c = document.createElement("canvas").getContext("2d");
          c.fillStyle = style.backgroundColor;
          c.fillRect(0, 0, 1, 1);
          return Array.from(c.getImageData(0, 0, 1, 1).data.slice(0, 3));
        })(),
      };
    }, text);
    if (!state.found) return state;
    // Independent of the DOM: what is actually PAINTED near the toast's
    // left edge (its background, clear of the text) must be the toast's own
    // background colour, not the dialog's dimmed overlay.
    const shot = await page.screenshot({ clip: { x: Math.round(state.box.x + 6), y: Math.round(state.box.y + state.box.h / 2), width: 1, height: 1 } });
    const { data } = await sharp(shot).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const [r, g, b] = state.bg;
    const paintedIsToast = Math.abs(data[0] - r) <= 10 && Math.abs(data[1] - g) <= 10 && Math.abs(data[2] - b) <= 10;
    const { box, bg, ...rest } = state;
    void box;
    void bg;
    return { ...rest, paintedIsToast };
  }

  {
    const { ctx, page, escaped, actions, storageUploads } = await setup("library");
    await check(`${engine}: sidebar Media Library -- one oversize file: the toast only, no red inline copy`, async () => {
      await page.locator('input[type="file"]').first().waitFor({ state: "attached", timeout: 120000 });
      await page.locator('input[type="file"]').first().setInputFiles([big]);
      const s = await toastState(page, expectedOne);
      assert.deepEqual(s, { found: true, onTop: true, visible: true, inViewport: true, inlineErrorCopies: 0, totalCopies: 1, paintedIsToast: true });
    });
    await check(`${engine}: sidebar Media Library -- multi-file summary still names every rejected file, once`, async () => {
      await page.waitForTimeout(500);
      await page.locator('input[type="file"]').first().setInputFiles([zip, big]);
      const s = await toastState(page, expectedMany);
      assert.equal(s.totalCopies, 1);
      assert.equal(s.inlineErrorCopies, 0);
      assert.equal(storageUploads.length, 0, "nothing uploaded");
      assert.deepEqual(actions, [], "no Server Action called");
      assert.deepEqual(escaped, []);
    });
    await ctx.close();
  }
  {
    const { ctx, page, escaped, actions, storageUploads } = await setup("dialog");
    await check(`${engine}: Choose-from-library dialog -- the toast is visible ABOVE the open dialog, with no inline copy`, async () => {
      await page.getByText("Upload New Asset").waitFor({ timeout: 120000 });
      await page.locator("[data-picker-input]").setInputFiles([zip, big]);
      const s = await toastState(page, expectedMany);
      assert.deepEqual(s, { found: true, onTop: true, visible: true, inViewport: true, inlineErrorCopies: 0, totalCopies: 1, paintedIsToast: true });
    });
    await check(`${engine}: Choose-from-library dialog -- an unplayable video is named in the toast, never uploaded`, async () => {
      await page.waitForTimeout(500);
      await page.locator("[data-picker-input]").setInputFiles([avi]);
      const s = await toastState(
        page,
        `"holiday.avi" wasn't uploaded. Unsupported video format — This video can't be played in your browser. Please convert it to MP4 (H.264) and try again.`,
      );
      assert.equal(s.onTop, true);
      assert.equal(s.paintedIsToast, true);
      assert.equal(s.totalCopies, 1);
      assert.equal(storageUploads.length, 0);
      assert.deepEqual(actions, []);
      assert.deepEqual(escaped, []);
    });
    await ctx.close();
  }
}

// --- E. Brief: reference videos the browser can't play ----------------------
const BRIEF_PAGE = `"use client";
// TEMPORARY -- created and deleted by scripts/upload-validation.check.mjs. Never commit.
import { useEffect } from "react";
import { checkBriefVideo, uploadFilesAndSummarize } from "@/lib/video-poster";
export default function Page() {
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__brief = async (file: File) => {
      const r = await checkBriefVideo(file);
      return { status: r.status, posterBytes: r.status === "decoded" ? r.poster.size : 0 };
    };
    w.__strict = async (file: File, context: "media" | "content") =>
      uploadFilesAndSummarize("00000000-0000-0000-0000-000000000000", () => {}, [file], context);
    document.body.dataset.ready = "1";
  }, []);
  return <p>brief harness</p>;
}
`;

const BRIEF_LIGHTBOX_PAGE = `"use client";
// TEMPORARY -- created and deleted by scripts/upload-validation.check.mjs. Never commit.
import { useSearchParams } from "next/navigation";
import { VideoLightbox } from "@/app/projects/[projectId]/brief/brief-board";
export default function Page() {
  const src = useSearchParams().get("src") ?? "https://media.test/holiday.avi";
  return <VideoLightbox url={src} poster={null} downloadName="holiday" onClose={() => {}} />;
}
`;

async function partE(engine, browser) {
  console.log(`\n### E. Brief accepts recognised but unplayable reference videos -- ${engine}`);
  const unavailable =
    "Video preview unavailable — This file can't be previewed in your browser. Download it to view it in a compatible application.";
  {
    const { ctx, page, escaped, storageUploads } = await newIsolatedPage(browser);
    await page.goto(`${BASE}/brief`, { waitUntil: "load" });
    await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 120000 });
    await page.evaluate(
      ({ avi, video }) => {
        const fromB64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        window.__bf = {
          avi: new File([fromB64(avi)], "holiday.avi", { type: "video/x-msvideo" }),
          // a non-video file merely NAMED like a video (the OS types it by extension)
          fakeAvi: new File([new TextEncoder().encode("this is a text file, not a video ".repeat(40))], "notes.avi", { type: "video/x-msvideo" }),
          video: video ? new File([fromB64(video.b64)], "clip.webm", { type: video.type }) : null,
        };
      },
      { avi: fakeAviBytes().toString("base64"), video: sharedVideo },
    );
    await check(`${engine}: Brief -- an AVI container the browser can't play is accepted as "preview-unavailable" (no poster)`, async () => {
      const r = await page.evaluate(() => window.__brief(window.__bf.avi));
      assert.deepEqual(r, { status: "preview-unavailable", posterBytes: 0 });
    });
    await check(`${engine}: Brief -- a non-video file named .avi is still rejected`, async () => {
      const r = await page.evaluate(() => window.__brief(window.__bf.fakeAvi));
      assert.equal(r.status, "rejected");
    });
    await check(`${engine}: the SAME AVI is still rejected in Grid/Post Editor (media) and Content -- strict rule unchanged`, async () => {
      storageUploads.length = 0;
      for (const context of ["media", "content"]) {
        const summary = await page.evaluate((c) => window.__strict(window.__bf.avi, c), context);
        assert.match(summary, /^"holiday\.avi" wasn't uploaded\. Unsupported video format — /, context);
      }
      assert.equal(storageUploads.length, 0, "nothing reached storage");
    });
    const playableHere = engine === "chromium" && sharedVideo;
    if (playableHere) {
      await check(`${engine}: Brief -- a playable video still decodes with a poster (unchanged)`, async () => {
        const r = await page.evaluate(() => window.__brief(window.__bf.video));
        assert.equal(r.status, "decoded");
        assert.ok(r.posterBytes > 0);
      });
    } else {
      skipped++;
      console.log(`SKIP - ${engine}: Brief -- a playable video still decodes with a poster (no video this engine can both create and play)`);
    }
    await check(`${engine}: Brief helper checks left the machine untouched`, async () => assert.deepEqual(escaped, []));
    await ctx.close();
  }
  {
    const { ctx, page, escaped } = await newIsolatedPage(browser);
    const avi = fakeAviBytes();
    const downloads = [];
    await page.route("https://media.test/**", (r) => {
      const name = new URL(r.request().url()).pathname.slice(1);
      if (r.request().resourceType() === "fetch") downloads.push(name);
      if (name === "holiday.avi") return r.fulfill({ body: avi, contentType: "video/x-msvideo", headers: { "access-control-allow-origin": "*" } });
      if (name === "clip.webm" && sharedVideo)
        return r.fulfill({ body: Buffer.from(sharedVideo.b64, "base64"), contentType: sharedVideo.type, headers: { "access-control-allow-origin": "*" } });
      return r.fulfill({ status: 404 });
    });
    await check(`${engine}: Brief preview of an unplayable video -- placeholder, the explanation and a working Download`, async () => {
      await page.goto(`${BASE}/brief-lightbox`, { waitUntil: "load" });
      await page.getByText(unavailable).waitFor({ timeout: 120000 });
      assert.equal(await page.locator("video").count(), 0, "no blank player left behind");
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 15000 }),
        page.getByRole("button", { name: "Download video" }).click(),
      ]);
      assert.equal(download.suggestedFilename(), "holiday.avi");
      assert.deepEqual(downloads, ["holiday.avi"], "downloads the original file");
      assert.deepEqual(escaped, []);
    });
    if (engine === "chromium" && sharedVideo) {
      await check(`${engine}: Brief preview of a playable video -- normal player, no fallback (unchanged)`, async () => {
        await page.goto(`${BASE}/brief-lightbox?src=${encodeURIComponent("https://media.test/clip.webm")}`, { waitUntil: "load" });
        await page.locator("video").waitFor({ timeout: 120000 });
        await page.waitForFunction(() => (document.querySelector("video")?.readyState ?? 0) >= 1, null, { timeout: 20000 });
        assert.equal(await page.getByText(unavailable).count(), 0);
      });
    } else {
      skipped++;
      console.log(`SKIP - ${engine}: Brief preview of a playable video -- normal player (no video this engine can both create and play)`);
    }
    await ctx.close();
  }
}

const OVERSIZE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "upload-validation-check-"));

if (fs.existsSync(HARNESS_DIR)) {
  console.error(`Refusing to run: ${HARNESS_DIR} already exists.`);
  process.exit(1);
}
let server;
const browsers = [];
try {
  for (const [dir, file, source] of [
    ["helpers", "page.tsx", HELPERS_PAGE],
    ["editor", "page.tsx", EDITOR_PAGE],
    ["library", "page.tsx", LIBRARY_PAGE],
    ["dialog", "page.tsx", DIALOG_PAGE],
    ["brief", "page.tsx", BRIEF_PAGE],
    ["brief-lightbox", "page.tsx", BRIEF_LIGHTBOX_PAGE],
  ]) {
    fs.mkdirSync(path.join(HARNESS_DIR, dir), { recursive: true });
    fs.writeFileSync(path.join(HARNESS_DIR, dir, file), source);
  }
  server = spawn(`npx next dev --port ${PORT}`, { cwd: ROOT, shell: true, stdio: "ignore" });
  await waitForServer(`${BASE}/helpers`, 180000);
  for (const [engine, launcher] of [
    ["chromium", chromium],
    ["webkit", webkit],
  ]) {
    const browser = await launcher.launch();
    browsers.push(browser);
    await partAB(engine, browser);
    await partC(engine, browser);
    await partD(engine, browser);
    await partE(engine, browser);
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
  fs.rmSync(OVERSIZE_DIR, { recursive: true, force: true });
  // next dev registers every route it compiled in generated type stubs
  // (.next/dev/types, included by tsconfig). Left alone, they'd keep
  // referencing the deleted harness files and break `tsc`/`next build`.
  fs.rmSync(path.join(ROOT, ".next", "dev", "types"), { recursive: true, force: true });
}
console.log(`
${passed} checks passed, ${failed} failed, ${skipped} skipped`);
if (failed) process.exit(1);
