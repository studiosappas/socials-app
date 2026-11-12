// Tests for video-frame-capture.ts -- the decision half of video poster
// capture. Black HEVC posters (Staging, Content + Media Library) came from
// drawing a not-yet-decoded <video> onto a canvas and storing the empty
// result as a black JPEG. These pin down: a frame is only drawn once it is
// ready, an empty/uniformly black capture is never a poster unless the
// caller chose that exact moment, dark-but-real frames still pass, and
// every wait is bounded. A fake FrameSource stands in for <video>+canvas.
// Run with:
//   node --experimental-strip-types src/lib/video-frame-capture.test.ts

import assert from "node:assert/strict";
import fs from "node:fs";
import { captureBestFrame, classifyFrame, posterSeekTimes, type FrameClass, type FrameSource } from "./video-frame-capture.ts";

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed++;
  console.log(`ok - ${name}`);
}

// --- classifyFrame -----------------------------------------------------------

// n pixels of one RGBA colour, optionally with `patch` pixels of another.
function pixels(n: number, rgba: [number, number, number, number], patch?: { count: number; rgba: [number, number, number, number] }) {
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) out.set(patch && i < patch.count ? patch.rgba : rgba, i * 4);
  return out;
}
const N = 32 * 32;

await test("nothing drawn (transparent canvas) is empty, never a poster", () => {
  assert.equal(classifyFrame(pixels(N, [0, 0, 0, 0])), "empty");
  assert.equal(classifyFrame(new Uint8ClampedArray(0)), "empty");
  // mostly undrawn with a sliver drawn: still empty
  assert.equal(classifyFrame(pixels(N, [0, 0, 0, 0], { count: N / 4, rgba: [200, 180, 160, 255] })), "empty");
});

await test("an opaque, uniformly near-black canvas is black", () => {
  assert.equal(classifyFrame(pixels(N, [0, 0, 0, 255])), "black");
  assert.equal(classifyFrame(pixels(N, [12, 12, 12, 255])), "black");
});

await test("a dark but real frame is ok -- one brighter detail is enough", () => {
  assert.equal(classifyFrame(pixels(N, [6, 5, 7, 255], { count: 3, rgba: [40, 30, 25, 255] })), "ok");
  assert.equal(classifyFrame(pixels(N, [13, 13, 13, 255])), "ok", "just above the black threshold");
  assert.equal(classifyFrame(pixels(N, [0, 0, 0, 255], { count: 50, rgba: [255, 255, 255, 255] })), "ok", "black frame with a title");
});

await test("a normal frame is ok", () => {
  assert.equal(classifyFrame(pixels(N, [120, 90, 60, 255])), "ok");
});

// --- posterSeekTimes ---------------------------------------------------------

await test("default moments: just past 0, ~1 s, the middle", () => {
  assert.deepEqual(posterSeekTimes(10), [0.1, 1, 5]);
  assert.deepEqual(posterSeekTimes(2), [0.1, 0.5, 1]);
});

await test("short and unknown durations stay inside the video, without near-duplicates", () => {
  assert.deepEqual(posterSeekTimes(0.3), [0.1], "0.15 s is within 0.05 s of 0.1 s -- a near-duplicate");
  assert.deepEqual(posterSeekTimes(0.5), [0.1, 0.25]);
  assert.deepEqual(posterSeekTimes(Number.NaN), [0.1, 0.25, 0.5]);
  assert.deepEqual(posterSeekTimes(Infinity), [0.1, 0.25, 0.5]);
  assert.deepEqual(posterSeekTimes(0), [0.1, 0.25, 0.5]);
});

await test("a caller-chosen moment (Edit Cover) is the only one tried", () => {
  assert.deepEqual(posterSeekTimes(10, 3.2), [3.2]);
  assert.deepEqual(posterSeekTimes(10, 0), [0]);
});

// --- captureBestFrame --------------------------------------------------------

// A scripted <video>+canvas. Per seek index: is a frame ready right away,
// does muted play produce one, and what does drawing it look like.
type Step = { ready?: boolean; playReady?: boolean; frame?: FrameClass | null };
function fakeSource(steps: Step[], opts: { cancelAfterSeeks?: number } = {}) {
  const log: string[] = [];
  const waits: { kind: string; ms: number }[] = [];
  let seekIndex = -1;
  let cancelled = false;
  const step = () => steps[Math.min(seekIndex, steps.length - 1)] ?? {};
  const source: FrameSource = {
    cancelled: () => cancelled,
    async seek(time) {
      seekIndex++;
      log.push(`seek ${time}`);
      if (opts.cancelAfterSeeks !== undefined && seekIndex + 1 >= opts.cancelAfterSeeks) cancelled = true;
    },
    async waitForFrame(ms) {
      waits.push({ kind: "frame", ms });
      return Boolean(step().ready);
    },
    async nudgePlay(ms) {
      waits.push({ kind: "play", ms });
      log.push("play");
      return Boolean(step().playReady);
    },
    draw() {
      log.push("draw");
      const f = step().frame;
      return f === undefined ? "ok" : f;
    },
  };
  return { source, log, waits };
}
const OPTS = { frameWaitMs: 600, playWaitMs: 1500, acceptBlack: false };

await test("readiness: a decoded frame right after the seek is captured once", async () => {
  const f = fakeSource([{ ready: true, frame: "ok" }]);
  const out = await captureBestFrame(f.source, [0.1, 1, 5], OPTS);
  assert.equal(out.result, "ok");
  assert.deepEqual(f.log, ["seek 0.1", "draw"], "no play, no extra seeks");
  assert.deepEqual(out.attempts, [{ time: 0.1, ready: true, via: "frame", frame: "ok" }]);
});

await test("readiness: an undecoded video is NEVER drawn -- that was the black poster", async () => {
  const f = fakeSource([{ ready: false, playReady: false }]);
  const out = await captureBestFrame(f.source, [0.1, 1, 5], OPTS);
  assert.equal(out.result, "none");
  assert.ok(!f.log.includes("draw"), "draw never called");
  assert.equal(out.attempts.length, 3);
  assert.ok(out.attempts.every((a) => !a.ready && a.frame === "skipped"));
});

await test("fallback: no frame after the seek, muted play produces one", async () => {
  const f = fakeSource([{ ready: false, playReady: true, frame: "ok" }]);
  const out = await captureBestFrame(f.source, [0.1], OPTS);
  assert.equal(out.result, "ok");
  assert.deepEqual(f.log, ["seek 0.1", "play", "draw"]);
  assert.equal(out.attempts[0].via, "play");
});

await test("timeouts: every wait is bounded by the caller's limits", async () => {
  const f = fakeSource([{ ready: false, playReady: false }]);
  await captureBestFrame(f.source, [0.1, 1], OPTS);
  assert.deepEqual(f.waits, [
    { kind: "frame", ms: 600 },
    { kind: "play", ms: 1500 },
    { kind: "frame", ms: 600 },
    { kind: "play", ms: 1500 },
  ]);
});

await test("timeouts: the overall timeout firing mid-capture stops it, with no poster", async () => {
  const f = fakeSource([{ ready: true, frame: "black" }, { ready: true, frame: "ok" }], { cancelAfterSeeks: 1 });
  const out = await captureBestFrame(f.source, [0.1, 1, 5], OPTS);
  assert.equal(out.result, "none");
  assert.deepEqual(f.log, ["seek 0.1"], "nothing drawn after cancellation, no further seeks");
});

await test("blank capture: an empty canvas moves on, and a later real frame is used", async () => {
  const f = fakeSource([{ ready: true, frame: "empty" }, { ready: true, frame: "ok" }]);
  const out = await captureBestFrame(f.source, [0.1, 1, 5], OPTS);
  assert.equal(out.result, "ok");
  assert.deepEqual(out.attempts.map((a) => [a.time, a.frame]), [[0.1, "empty"], [1, "ok"]]);
});

await test("dark opening: black at 0.1 s, a real picture at 1 s -- the video gets a real poster", async () => {
  const f = fakeSource([{ ready: true, frame: "black" }, { ready: true, frame: "ok" }]);
  const out = await captureBestFrame(f.source, [0.1, 1, 5], OPTS);
  assert.equal(out.result, "ok");
  assert.equal(out.attempts.length, 2);
});

await test("blank capture: black at every moment is no poster (never a black poster), not a rejection", async () => {
  const f = fakeSource([{ ready: true, frame: "black" }]);
  const out = await captureBestFrame(f.source, [0.1, 1, 5], OPTS);
  assert.equal(out.result, "none");
  assert.equal(out.attempts.length, 3);
});

await test("a caller-chosen black moment is kept (Edit Cover), an empty one is not", async () => {
  const black = await captureBestFrame(fakeSource([{ ready: true, frame: "black" }]).source, [3.2], { ...OPTS, acceptBlack: true });
  assert.equal(black.result, "black-accepted");
  const empty = await captureBestFrame(fakeSource([{ ready: true, frame: "empty" }]).source, [3.2], { ...OPTS, acceptBlack: true });
  assert.equal(empty.result, "none");
  const undecoded = await captureBestFrame(fakeSource([{ ready: false, playReady: false }]).source, [3.2], { ...OPTS, acceptBlack: true });
  assert.equal(undecoded.result, "none");
});

await test("acceptBlack only keeps black when it was the LAST thing drawn", async () => {
  // black, then an undecoded attempt: the canvas no longer holds a frame we vouch for
  const f = fakeSource([{ ready: true, frame: "black" }, { ready: false, playReady: false }]);
  const out = await captureBestFrame(f.source, [1, 2], { ...OPTS, acceptBlack: true });
  assert.equal(out.result, "none");
});

await test("an unreadable canvas (tainted / no context) stops with no poster", async () => {
  const f = fakeSource([{ ready: true, frame: null }]);
  const out = await captureBestFrame(f.source, [0.1, 1, 5], OPTS);
  assert.equal(out.result, "unreadable");
  assert.equal(out.attempts.length, 1);
});

// --- wiring ------------------------------------------------------------------

await test("wiring: video-poster.ts captures through captureBestFrame and only encodes a vouched-for frame", () => {
  const src = fs.readFileSync(new URL("./video-poster.ts", import.meta.url), "utf8");
  const body = src.slice(src.indexOf("function decodeVideoSrc("), src.indexOf("// Every upload action here"));
  assert.match(body, /captureBestFrame\(source, times, \{/);
  assert.match(body, /acceptBlack: seekTime !== undefined/);
  assert.match(body, /posterSeekTimes\(video\.duration, seekTime\)/);
  assert.match(body, /typeof video\.requestVideoFrameCallback === "function"/, "frame callbacks are feature-detected");
  assert.match(body, /readyState >= HAVE_CURRENT_DATA/);
  assert.match(src, /const HAVE_CURRENT_DATA = 2;/);
  // the JPEG is only made after an ok / black-accepted outcome
  const toBlobAt = body.indexOf("canvas.toBlob(");
  const guardAt = body.indexOf('outcome.result !== "ok" && outcome.result !== "black-accepted"');
  assert.ok(guardAt > 0 && toBlobAt > guardAt, "toBlob only after the outcome check");
  assert.equal(body.match(/canvas\.toBlob\(/g)?.length, 1, "no other path turns the canvas into a poster");
  // the old unconditional 1.2 s capture is gone
  assert.doesNotMatch(body, /setTimeout\(capture, 1200\)/);
  // unchanged contract: unplayable files are still "unsupported"
  assert.match(body, /settle\(\{ status: "unsupported" \}\)/);
  assert.match(body, /MEDIA_ERR_DECODE \|\| code === MEDIA_ERR_SRC_NOT_SUPPORTED/);
});

console.log(`\n${passed} passed`);
