// Offline tests for pinterest-media.ts -- no network: page HTML comes from
// fixtures captured from real pin pages (src/lib/__fixtures__/), and every
// media fetch is a fake MediaFetcher. Run with:
//   node --experimental-strip-types src/lib/pinterest-media.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  extractPinterestVideoMetadata,
  isPinterestHost,
  pinIdFromUrl,
  resolvePinterestVideo,
  PINTEREST_VIDEO_TOO_LARGE_MESSAGE,
  PINTEREST_VIDEO_UNAVAILABLE_MESSAGE,
  type FetchedMedia,
  type MediaFetcher,
} from "./pinterest-media.ts";

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
const VIDEO_PIN_URL = "https://www.pinterest.com/pin/788411478524198894/";
const IMAGE_PIN_URL = "https://www.pinterest.com/pin/499055202483639919/";
const VIDEO_PIN_HTML = fixture("pinterest-video-pin.html");
const IMAGE_PIN_HTML = fixture("pinterest-image-pin.html");
const MP4 = "https://v1.pinimg.com/videos/720p/63/45/98/634598901dec1f6d81a04ced95b7d183.mp4";
const POSTER = "https://i.pinimg.com/videos/thumbnails/originals/63/45/98/634598901dec1f6d81a04ced95b7d183-00001.jpg";
const OG_IMAGE = "https://i.pinimg.com/736x/bf/43/cc/bf43cce7774da02997f0d9bb4dd00183.jpg";

// Fake network: url -> { type, bytes } | "too_large" | "missing". Honors the
// MediaFetcher contract (wrong type -> wrong_type) and records every call.
function fakeFetcher(routes: Record<string, { type: string; bytes: string } | "too_large" | "missing">) {
  const calls: { url: string; typePrefix: string }[] = [];
  const fetcher: MediaFetcher = async (url, typePrefix): Promise<FetchedMedia> => {
    calls.push({ url, typePrefix });
    const route = routes[url] ?? "missing";
    if (route === "missing") return { ok: false, reason: "unavailable" };
    if (route === "too_large") return { ok: false, reason: "too_large" };
    if (!route.type.startsWith(typePrefix)) return { ok: false, reason: "wrong_type" };
    return { ok: true, buffer: Buffer.from(route.bytes), contentType: route.type, finalUrl: url };
  };
  return { fetcher, calls };
}

await test("fixtures are real-shaped: the video pin's og:image is the poster and it has no og:video", () => {
  assert.match(VIDEO_PIN_HTML, new RegExp(`content="${OG_IMAGE}"[^>]*property="og:image"`));
  assert.doesNotMatch(VIDEO_PIN_HTML, /property="(og:video[^"]*|twitter:player[^"]*)"/);
});

await test("host + pin id detection (country domains, slug urls; lookalikes rejected)", () => {
  for (const h of ["pinterest.com", "www.pinterest.com", "in.pinterest.com", "pinterest.co.uk", "pinterest.com.au", "pinterest.de"]) {
    assert.equal(isPinterestHost(h), true, h);
  }
  for (const h of ["notpinterest.com", "pinterest.com.evil.io", "pinimg.com", "example.com", "pin.it"]) {
    assert.equal(isPinterestHost(h), false, h);
  }
  assert.equal(pinIdFromUrl(VIDEO_PIN_URL), "788411478524198894");
  assert.equal(pinIdFromUrl("https://in.pinterest.com/pin/dry-tinde-ki-sabji--454933999867625815/"), "454933999867625815");
  assert.equal(pinIdFromUrl("https://www.pinterest.com/littlediyyoutube/food-video-pins/"), null);
});

await test("1. image pin -> not a video (caller keeps its existing image behavior)", async () => {
  const meta = extractPinterestVideoMetadata(IMAGE_PIN_HTML, IMAGE_PIN_URL, null);
  assert.deepEqual(meta, { isVideo: false, videoUrls: [], posterUrl: null });
  const { fetcher, calls } = fakeFetcher({});
  assert.deepEqual(await resolvePinterestVideo(meta, fetcher), { kind: "not_video" });
  assert.equal(calls.length, 0, "no network for an image pin");
});

await test("2. video pin -> video asset from the VideoObject contentUrl", async () => {
  const meta = extractPinterestVideoMetadata(VIDEO_PIN_HTML, VIDEO_PIN_URL, null);
  assert.equal(meta.isVideo, true);
  assert.deepEqual(meta.videoUrls, [MP4]);
  assert.equal(meta.posterUrl, POSTER);
  const { fetcher } = fakeFetcher({ [MP4]: { type: "video/mp4", bytes: "MP4" }, [POSTER]: { type: "image/jpeg", bytes: "JPG" } });
  const r = await resolvePinterestVideo(meta, fetcher);
  assert.equal(r.kind, "video");
  if (r.kind !== "video") return;
  assert.equal(r.buffer.toString(), "MP4");
  assert.equal(r.contentType, "video/mp4");
  assert.equal(r.fileName, "634598901dec1f6d81a04ced95b7d183.mp4");
});

await test("3. poster/thumbnail (and og:image) are NEVER the primary media", async () => {
  const meta = extractPinterestVideoMetadata(VIDEO_PIN_HTML, VIDEO_PIN_URL, null);
  assert.ok(!meta.videoUrls.includes(POSTER) && !meta.videoUrls.includes(OG_IMAGE));
  const { fetcher, calls } = fakeFetcher({ [MP4]: { type: "video/mp4", bytes: "MP4" }, [POSTER]: { type: "image/jpeg", bytes: "JPG" } });
  const r = await resolvePinterestVideo(meta, fetcher);
  assert.ok(r.kind === "video");
  assert.deepEqual(calls[0], { url: MP4, typePrefix: "video/" }, "primary fetch must demand video/*");
  assert.ok(calls.every((c) => c.url !== OG_IMAGE), "og:image never fetched on the video path");
  if (r.kind === "video") assert.deepEqual(r.poster && { t: r.poster.contentType, b: r.poster.buffer.toString() }, { t: "image/jpeg", b: "JPG" });
});

await test("4. video media type survives mapping: kind video + video/* type + known video extension", async () => {
  const meta = extractPinterestVideoMetadata(VIDEO_PIN_HTML, VIDEO_PIN_URL, null);
  const { fetcher } = fakeFetcher({ [MP4]: { type: "video/mp4", bytes: "MP4" } });
  const r = await resolvePinterestVideo(meta, fetcher);
  assert.ok(r.kind === "video");
  if (r.kind !== "video") return;
  // addBriefTaskLink stores resolved.kind as brief_task_items.kind and derives
  // the storage extension from the fileName (brief.ts createBriefMediaItem);
  // Brief renders kind === "video" through its <video> player.
  assert.ok(r.contentType.startsWith("video/"));
  assert.equal(r.fileName.split(".").pop(), "mp4");
  assert.equal(r.poster, null, "missing poster is fine -- the video still imports");
});

await test("5. a poster that fails to load never blocks the video", async () => {
  const meta = extractPinterestVideoMetadata(VIDEO_PIN_HTML, VIDEO_PIN_URL, null);
  const { fetcher } = fakeFetcher({ [MP4]: { type: "video/mp4", bytes: "MP4" }, [POSTER]: "missing" });
  const r = await resolvePinterestVideo(meta, fetcher);
  assert.equal(r.kind, "video");
});

await test("6a. video pin whose file is unreachable -> clear error, NOT the poster as an image", async () => {
  const meta = extractPinterestVideoMetadata(VIDEO_PIN_HTML, VIDEO_PIN_URL, null);
  const { fetcher, calls } = fakeFetcher({ [MP4]: "missing", [POSTER]: { type: "image/jpeg", bytes: "JPG" } });
  assert.deepEqual(await resolvePinterestVideo(meta, fetcher), { kind: "error", message: PINTEREST_VIDEO_UNAVAILABLE_MESSAGE });
  assert.ok(calls.every((c) => c.typePrefix === "video/"), "nothing image-typed fetched as a fallback");
});

await test("6b. HLS-only video (m3u8, not video/*) -> error, not image", async () => {
  const hls = VIDEO_PIN_HTML.replace(MP4, "https://v1.pinimg.com/videos/v2/hls/63/45/98/x_mobile.m3u8");
  const meta = extractPinterestVideoMetadata(hls, VIDEO_PIN_URL, null);
  const { fetcher } = fakeFetcher({ "https://v1.pinimg.com/videos/v2/hls/63/45/98/x_mobile.m3u8": { type: "application/x-mpegurl", bytes: "#EXTM3U" } });
  assert.equal((await resolvePinterestVideo(meta, fetcher)).kind, "error");
});

await test("6c. video over the size ceiling -> the too-large message", async () => {
  const meta = extractPinterestVideoMetadata(VIDEO_PIN_HTML, VIDEO_PIN_URL, null);
  const { fetcher } = fakeFetcher({ [MP4]: "too_large" });
  assert.deepEqual(await resolvePinterestVideo(meta, fetcher), { kind: "error", message: PINTEREST_VIDEO_TOO_LARGE_MESSAGE });
});

await test("6d. VideoObject with no contentUrl at all -> still recognized as video -> error", async () => {
  const noUrl = VIDEO_PIN_HTML.replace(`"contentUrl":"${MP4}"`, `"contentUrl":""`);
  const meta = extractPinterestVideoMetadata(noUrl, VIDEO_PIN_URL, null);
  assert.equal(meta.isVideo, true);
  assert.deepEqual(meta.videoUrls, []);
  assert.equal((await resolvePinterestVideo(meta, fakeFetcher({}).fetcher)).kind, "error");
});

await test("robustness: og:video is used as a fallback candidate", async () => {
  const withOg = extractPinterestVideoMetadata(IMAGE_PIN_HTML, IMAGE_PIN_URL, "https://v1.pinimg.com/videos/og.mp4");
  assert.deepEqual(withOg, { isVideo: true, videoUrls: ["https://v1.pinimg.com/videos/og.mp4"], posterUrl: null });
});

// ---- RE-PINS: the case the first fix missed (QA failure, 2026-10-01) -------
const REPIN_URL = "https://www.pinterest.com/pin/788411478522345343/";
const REPIN_HTML = fixture("pinterest-video-repin.html");
const REPIN_MP4 = "https://v1.pinimg.com/videos/mc/720p/11/54/fb/1154fb13d7c8b19b9108b96414298a0a.mp4";

await test("re-pin fixture is real-shaped: VideoObject/og:url/canonical name the ORIGINAL pin, not the pasted id", () => {
  assert.equal(pinIdFromUrl(REPIN_URL), "788411478522345343");
  assert.match(REPIN_HTML, /"@id":"https:\/\/www\.pinterest\.com\/pin\/140806229581762\/"/);
  assert.doesNotMatch(REPIN_HTML, /"@id":"[^"]*788411478522345343/);
  assert.doesNotMatch(REPIN_HTML, /property="(og:video[^"]*|twitter:player[^"]*)"/);
});

await test("re-pin of a video -> the actual video (previously: poster imported as an image)", async () => {
  const meta = extractPinterestVideoMetadata(REPIN_HTML, REPIN_URL, null);
  assert.equal(meta.isVideo, true);
  assert.deepEqual(meta.videoUrls, [REPIN_MP4]);
  const { fetcher } = fakeFetcher({ [REPIN_MP4]: { type: "video/mp4", bytes: "MP4" } });
  const r = await resolvePinterestVideo(meta, fetcher);
  assert.equal(r.kind, "video");
  if (r.kind === "video") assert.equal(r.buffer.toString(), "MP4");
});

await test("a VideoObject whose id matches NOTHING about this page: still a video pin -> error, never the poster image", async () => {
  const html = `<meta content="https://www.pinterest.com/pin/222222222/" property="og:url"/>
<meta content="https://i.pinimg.com/736x/poster.jpg" property="og:image"/>
<script type="application/ld+json">{"@type":"VideoObject","@id":"https://www.pinterest.com/pin/111111111/","contentUrl":"https://v1.pinimg.com/videos/other.mp4"}</script>`;
  const meta = extractPinterestVideoMetadata(html, "https://www.pinterest.com/pin/333333333/", null);
  assert.deepEqual(meta, { isVideo: true, videoUrls: [], posterUrl: null }, "file untrusted, but the pin is still known to be a video");
  assert.equal((await resolvePinterestVideo(meta, fakeFetcher({}).fetcher)).kind, "error");
});

await test("robustness: @graph / array JSON-LD shapes and malformed blocks", () => {
  const graph = `<script type="application/ld+json">{"@graph":[{"@type":"WebPage"},{"@type":["VideoObject"],"contentUrl":["/v/a.mp4"],"thumbnailUrl":[{"url":"/t.jpg"}]}]}</script><script type="application/ld+json">{not json</script>`;
  const meta = extractPinterestVideoMetadata(graph, "https://www.pinterest.com/pin/123456789/", null);
  assert.deepEqual(meta, { isVideo: true, videoUrls: ["https://www.pinterest.com/v/a.mp4"], posterUrl: "https://www.pinterest.com/t.jpg" });
});

await test("7. non-Pinterest pages never take this path (host gate)", () => {
  // The resolver only calls into this module when isPinterestHost(finalUrl)
  // is true; every other site keeps the pre-existing og:video -> og:image flow.
  for (const url of ["https://www.youtube.com/watch?v=x", "https://www.dropbox.com/s/x/a.jpg", "https://example.com/article"]) {
    assert.equal(isPinterestHost(new URL(url).hostname), false, url);
  }
});

console.log(`\n${passed} passed`);
