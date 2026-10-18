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
  // referencing the deleted harness files and break `tsc`/`next build`.
  fs.rmSync(path.join(ROOT, ".next", "dev", "types"), { recursive: true, force: true });
}
console.log(`
${passed} checks passed, ${failed} failed, ${skipped} skipped`);
if (failed) process.exit(1);
