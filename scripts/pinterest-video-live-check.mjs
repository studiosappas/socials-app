// Opt-in LIVE verification of Brief's Pinterest import (NOT part of the
// offline test suite -- needs network access to pinterest.com/pinimg.com and
// Microsoft Edge or Google Chrome installed for real H.264 playback).
//
//   node --experimental-strip-types scripts/pinterest-video-live-check.mjs [pinUrl ...]
//
// Runs the app's REAL resolveExternalMedia (same SSRF-safe fetch path Brief's
// addBriefTaskLink uses) on each pin URL, then loads every resolved "video"
// into a real <video> element and requires: it decodes, has real
// dimensions/duration, advances when played, renders a non-blank frame, and
// is not byte-identical to its poster. Read-only: nothing is uploaded or
// written to any database.

import { register } from "node:module";
import { pathToFileURL } from "node:url";

// Resolves the app's "@/..." import alias (and extensionless .ts imports)
// for Node, so the real resolver module can be loaded unbundled.
const root = pathToFileURL(new URL("../src/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")).href;
register(
  "data:text/javascript," +
    encodeURIComponent(`
const root = ${JSON.stringify(root)};
export async function resolve(spec, ctx, next) {
  const target = spec.startsWith("@/") ? root + spec.slice(2) : null;
  if (target) for (const ext of [".ts", ".tsx", "/index.ts"]) { try { return await next(target + ext, ctx); } catch {} }
  return next(spec, ctx);
}`),
);

const { resolveExternalMedia } = await import("../src/lib/external-media-resolver.ts");
const { chromium } = await import("playwright");

const DEFAULT_PINS = [
  "https://www.pinterest.com/pin/788411478524198894/", // original video pin
  "https://www.pinterest.com/pin/788411478522345343/", // video RE-PIN (the case the first fix missed)
  "https://in.pinterest.com/pin/healthy-winter-drink-ginger-tea--623396773427706365/", // country domain + slug
  "https://www.pinterest.com/pin/499055202483639919/", // image pin
];
const pins = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_PINS;

const resolved = [];
for (const url of pins) {
  const r = await resolveExternalMedia(url);
  resolved.push({ url, r });
  console.log(`${url}\n  -> ${r.kind}${r.contentType ? ` ${r.contentType}` : ""}${r.buffer ? ` ${(r.buffer.length / 1048576).toFixed(2)}MB` : ""}${r.poster ? " +poster" : ""}${r.message ? ` "${r.message}"` : ""}`);
}

const browser = await chromium.launch({ channel: "msedge" }).catch(() => chromium.launch({ channel: "chrome" }));
const page = await browser.newPage();
const files = new Map();
await page.route("http://media.test/**", (route) => {
  const name = new URL(route.request().url()).pathname.slice(1);
  return files.has(name)
    ? route.fulfill({ body: files.get(name), contentType: "video/mp4" })
    : route.fulfill({ body: "<html><body></body></html>", contentType: "text/html" });
});
await page.goto("http://media.test/");

let failures = 0;
for (const [i, { url, r }] of resolved.entries()) {
  if (r.kind !== "video") continue;
  files.set(`${i}.mp4`, r.buffer);
  const res = await page.evaluate(async (src) => {
    const v = document.createElement("video");
    v.muted = true;
    v.src = src;
    document.body.append(v);
    const ok = await new Promise((done) => {
      v.onloadeddata = () => done(true);
      v.onerror = () => done(false);
      setTimeout(() => done(false), 15000);
    });
    if (!ok) return { decoded: false };
    v.currentTime = Math.min(1, v.duration / 2);
    await new Promise((done) => {
      v.onseeked = done;
      setTimeout(done, 5000);
    });
    await v.play().catch(() => {});
    await new Promise((done) => setTimeout(done, 400));
    const advanced = v.currentTime > 0.05;
    v.pause();
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const ctx = c.getContext("2d");
    ctx.drawImage(v, 0, 0, 64, 64);
    const d = ctx.getImageData(0, 0, 64, 64).data;
    let min = 255;
    let max = 0;
    for (let j = 0; j < d.length; j += 4) {
      const l = (d[j] + d[j + 1] + d[j + 2]) / 3;
      min = Math.min(min, l);
      max = Math.max(max, l);
    }
    return { decoded: true, w: v.videoWidth, h: v.videoHeight, dur: v.duration, advanced, contrast: max - min };
  }, `http://media.test/${i}.mp4`);
  const samePoster = !!(r.poster && r.buffer.equals(r.poster.buffer));
  const pass = res.decoded && res.w > 0 && res.dur > 0 && res.advanced && res.contrast >= 10 && !samePoster;
  if (!pass) failures++;
  console.log(`${pass ? "PLAYS" : "FAIL "} ${url} ${JSON.stringify({ ...res, samePoster })}`);
}
await browser.close();
if (failures) {
  console.error(`${failures} resolved video(s) failed real playback`);
  process.exit(1);
}
