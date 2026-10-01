// End-to-end (minus network and Supabase) tests for a Pinterest link import
// into Brief: real captured pin pages (src/lib/__fixtures__/) -> Pinterest
// video detection -> media resolution (fake network) -> the storage/DB plan
// brief.ts executes. Asserts on the BYTES that end up as the stored primary
// file (MP4 vs JPEG signature), not just on a "video" label. Run with:
//   node --experimental-strip-types src/lib/brief-media-import.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractPinterestVideoMetadata, resolvePinterestVideo, type MediaFetcher } from "./pinterest-media.ts";
import { planBriefMediaImport } from "./brief-media-import.ts";

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    throw err;
  }
}

const fixture = (name: string) => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");

// Minimal but genuine file signatures: an ISO-BMFF "ftyp" box (MP4) and a
// JPEG SOI/APP0 header -- enough to tell a stored video from a stored image.
const MP4_BYTES = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(12)]);
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const isMp4 = (b: Buffer) => b.subarray(4, 8).toString("latin1") === "ftyp";
const isJpeg = (b: Buffer) => b[0] === 0xff && b[1] === 0xd8;

// Every pinimg.com video URL serves MP4 bytes; every i.pinimg.com image URL
// (posters AND og:image) serves JPEG bytes -- like the real CDN.
const fakeNet: MediaFetcher = async (url, typePrefix) => {
  const isVideoUrl = /v1\.pinimg\.com\/videos\/.*\.mp4$/.test(url);
  const type = isVideoUrl ? "video/mp4" : "image/jpeg";
  if (!type.startsWith(typePrefix)) return { ok: false, reason: "wrong_type" };
  return { ok: true, buffer: isVideoUrl ? MP4_BYTES : JPEG_BYTES, contentType: type, finalUrl: url };
};

let n = 0;
const newId = () => `id${++n}`;

// Mirrors resolveExternalMedia's Pinterest branch + its og:image fallback and
// addBriefTaskLink -> createBriefMediaItem's plan step.
async function importPin(html: string, pageUrl: string) {
  const ogImage = html.match(/content="([^"]+)"[^>]*property="og:image"/)?.[1] ?? null;
  const pin = await resolvePinterestVideo(extractPinterestVideoMetadata(html, pageUrl, null), fakeNet);
  if (pin.kind === "error") return { error: pin.message };
  if (pin.kind === "video") {
    const ext = pin.fileName.split(".").pop();
    return {
      plan: planBriefMediaImport({
        projectId: "p",
        kind: "video",
        primary: { buffer: pin.buffer, contentType: pin.contentType },
        primaryExt: ext,
        poster: pin.poster ? { ...pin.poster, ext: "jpg" } : null,
        newId,
      }),
    };
  }
  // not a video pin -> the pre-existing og:image path
  const img = await fakeNet(ogImage!, "image/");
  assert.ok(img.ok);
  return {
    plan: planBriefMediaImport({
      projectId: "p",
      kind: "image",
      primary: { buffer: img.buffer, contentType: img.contentType },
      primaryExt: "jpg",
      poster: null,
      newId,
    }),
  };
}

for (const [name, file, url] of [
  ["original video pin", "pinterest-video-pin.html", "https://www.pinterest.com/pin/788411478524198894/"],
  ["video RE-PIN (the QA failure)", "pinterest-video-repin.html", "https://www.pinterest.com/pin/788411478522345343/"],
] as const) {
  await test(`${name}: stored PRIMARY file is the MP4 itself; the poster is a separate JPEG; item kind video`, async () => {
    const r = await importPin(fixture(file), url);
    assert.ok("plan" in r && r.plan, "expected an import, got an error");
    const plan = r.plan!;
    assert.equal(plan.itemKind, "video");
    assert.ok(isMp4(plan.original.buffer), "primary stored bytes must be MP4, not an image");
    assert.ok(!isJpeg(plan.original.buffer));
    assert.equal(plan.original.contentType, "video/mp4");
    assert.match(plan.original.path, /\.mp4$/);
    assert.ok(plan.poster && isJpeg(plan.poster.buffer), "poster kept for preview");
    assert.notEqual(plan.poster!.path, plan.original.path, "poster never replaces the video");
  });
}

await test("image pin: stored primary file is the image; no poster; item kind image (unchanged behavior)", async () => {
  const r = await importPin(fixture("pinterest-image-pin.html"), "https://www.pinterest.com/pin/499055202483639919/");
  assert.ok("plan" in r && r.plan);
  assert.equal(r.plan!.itemKind, "image");
  assert.ok(isJpeg(r.plan!.original.buffer));
  assert.equal(r.plan!.poster, null);
});

await test("nothing in the stored representation points back to Pinterest (not a link item)", async () => {
  for (const [file, url] of [
    ["pinterest-video-repin.html", "https://www.pinterest.com/pin/788411478522345343/"],
    ["pinterest-image-pin.html", "https://www.pinterest.com/pin/499055202483639919/"],
  ]) {
    const r = await importPin(fixture(file), url);
    const plan = r.plan!;
    assert.notEqual(plan.itemKind as string, "link");
    for (const p of [plan.original.path, plan.poster?.path]) if (p) assert.doesNotMatch(p, /pinterest|https?:/);
  }
});

await test("video pin whose file can't be fetched: no plan at all (nothing stored), not the poster as an image", async () => {
  const failingNet: MediaFetcher = async (url, typePrefix) =>
    typePrefix === "video/" ? { ok: false, reason: "unavailable" } : fakeNet(url, typePrefix);
  const html = fixture("pinterest-video-repin.html");
  const pin = await resolvePinterestVideo(extractPinterestVideoMetadata(html, "https://www.pinterest.com/pin/788411478522345343/", null), failingNet);
  assert.equal(pin.kind, "error");
});

await test("planBriefMediaImport never attaches a poster to an image", () => {
  const plan = planBriefMediaImport({
    projectId: "p",
    kind: "image",
    primary: { buffer: JPEG_BYTES, contentType: "image/jpeg" },
    primaryExt: "jpg",
    poster: { buffer: JPEG_BYTES, contentType: "image/jpeg", ext: "jpg" },
    newId,
  });
  assert.equal(plan.poster, null);
});

console.log(`\n${passed} passed`);
