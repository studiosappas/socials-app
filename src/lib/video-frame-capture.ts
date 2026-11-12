// The decision half of video poster capture (video-poster.ts does the DOM
// half): when a frame is actually ready, what a captured frame looks like,
// and which moments to try. Plain module -- no DOM -- so it's testable on
// its own.
//
// THE BUG THIS PREVENTS (HEVC videos uploaded to Content on Staging, black
// tiles in Content and the Media Library while the videos play fine): the
// capture drew the <video> onto a canvas as soon as the seek settled -- or
// 1.2 s after metadata loaded, whichever came first -- without checking a
// frame had actually been decoded. A canvas drawn from an undecoded video
// stays empty, and an empty canvas encodes to a solid black JPEG, which was
// then stored as the poster. Hardware-only decoders (HEVC in Chrome/Edge)
// are the slowest to deliver that first frame, so they hit it most.

// What a drawn canvas holds, read from a small RGBA sample of it.
//   "empty" -- nothing was drawn (mostly transparent pixels).
//   "black" -- opaque, but uniformly near-black: what an undecoded frame
//              copied off a hardware decoder looks like. A real dark scene
//              almost always has SOME brighter pixel, so it isn't this.
//   "ok"    -- a real picture.
export type FrameClass = "empty" | "black" | "ok";

// A pixel counts as drawn at this alpha or above; a frame is "empty" when
// fewer than half its pixels were drawn.
const DRAWN_ALPHA = 16;
// "black" only when EVERY drawn pixel's brightest channel is at or below
// this (0-255). Deliberately tight: dark-but-real frames pass.
const BLACK_MAX_CHANNEL = 12;

export function classifyFrame(rgba: ArrayLike<number>): FrameClass {
  const pixels = Math.floor(rgba.length / 4);
  if (pixels === 0) return "empty";
  let drawn = 0;
  let brightest = 0;
  for (let i = 0; i < pixels * 4; i += 4) {
    if (rgba[i + 3] < DRAWN_ALPHA) continue;
    drawn++;
    const max = Math.max(rgba[i], rgba[i + 1], rgba[i + 2]);
    if (max > brightest) brightest = max;
  }
  if (drawn < pixels / 2) return "empty";
  return brightest <= BLACK_MAX_CHANNEL ? "black" : "ok";
}

// The moments to try, in order. A caller-chosen time (Edit Cover's frame
// picker) is the only one tried -- the user picked that exact moment. The
// default starts a hair past 0 (frame 0 of many encodes is blank before the
// first keyframe), then ~1 s in, then the middle -- so a video that really
// does open on black (a fade-in) still gets a real poster.
export function posterSeekTimes(duration: number, explicit?: number): number[] {
  if (explicit !== undefined) return [explicit];
  const d = Number.isFinite(duration) && duration > 0 ? duration : 1;
  const times: number[] = [];
  for (const t of [Math.min(0.1, d / 2), Math.min(1, d * 0.25), d / 2]) {
    if (!times.some((x) => Math.abs(x - t) < 0.05)) times.push(t);
  }
  return times;
}

// What captureBestFrame needs from a real <video> + canvas (video-poster.ts)
// -- or from a fake, in tests.
export type FrameSource = {
  // Seek, resolving once the seek settled or a grace period passed (some
  // real files never fire "seeked").
  seek(time: number): Promise<void>;
  // Resolves true once a decoded frame is available to draw (a
  // requestVideoFrameCallback for this seek, or readyState >=
  // HAVE_CURRENT_DATA), false if none arrived within `ms`.
  waitForFrame(ms: number): Promise<boolean>;
  // Last resort for decoders that only produce frames while playing: muted
  // play, then pause on the first frame. Same contract as waitForFrame.
  nudgePlay(ms: number): Promise<boolean>;
  // Clears the canvas, draws the current frame and classifies it. null =
  // the canvas can't be drawn or read (no 2D context, or tainted).
  draw(): FrameClass | null;
  // The whole capture was abandoned (hard timeout / error) -- stop.
  cancelled(): boolean;
};

export type CaptureAttempt = { time: number; ready: boolean; via: "frame" | "play" | "none"; frame: FrameClass | null | "skipped" };
export type CaptureOutcome = {
  // "ok": the canvas holds a real frame. "black-accepted": the caller chose
  // the moment and it's black -- kept. "none": no usable frame -- the
  // caller must NOT turn the canvas into a poster. "unreadable": the canvas
  // couldn't be drawn or read.
  result: "ok" | "black-accepted" | "none" | "unreadable";
  attempts: CaptureAttempt[];
};

export async function captureBestFrame(
  source: FrameSource,
  times: number[],
  options: { frameWaitMs: number; playWaitMs: number; acceptBlack: boolean },
): Promise<CaptureOutcome> {
  const attempts: CaptureAttempt[] = [];
  let lastWasBlack = false;
  for (const time of times) {
    if (source.cancelled()) break;
    await source.seek(time);
    if (source.cancelled()) break;
    let via: CaptureAttempt["via"] = "frame";
    let ready = await source.waitForFrame(options.frameWaitMs);
    if (!ready && !source.cancelled()) {
      via = "play";
      ready = await source.nudgePlay(options.playWaitMs);
    }
    if (source.cancelled()) break;
    if (!ready) {
      // Never draw an undecoded video: that is exactly the empty canvas
      // that used to become a black poster.
      attempts.push({ time, ready: false, via: "none", frame: "skipped" });
      lastWasBlack = false;
      continue;
    }
    const frame = source.draw();
    attempts.push({ time, ready: true, via, frame });
    if (frame === null) return { result: "unreadable", attempts };
    if (frame === "ok") return { result: "ok", attempts };
    lastWasBlack = frame === "black";
  }
  // Only a caller-chosen moment keeps a black frame -- and only when it was
  // the LAST thing drawn, so the canvas really holds it.
  if (options.acceptBlack && lastWasBlack) return { result: "black-accepted", attempts };
  return { result: "none", attempts };
}
