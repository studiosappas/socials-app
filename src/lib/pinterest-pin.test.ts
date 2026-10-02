// Offline regression tests for the Pinterest Pin flow approved 2026-10-02
// ("Option 2": page data first, ONE PinResource fallback for multi-item Pins
// whose page lacks per-item data, picker for multi-item Pins). No network:
// pages and the PinResource response are fixtures captured from the real Pin
// that exposed the bug (src/lib/__fixtures__/), and every media/endpoint
// request goes to a recording fake. Run with:
//   node --experimental-strip-types src/lib/pinterest-pin.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  pinMediaFromPage,
  pinMediaFromPinResource,
  resolvePinterestPin,
  PINTEREST_ITEMS_UNAVAILABLE_MESSAGE,
  PINTEREST_PIN_CHANGED_MESSAGE,
  PINTEREST_VIDEO_UNAVAILABLE_MESSAGE,
  type MediaFetcher,
  type PinResourceFetcher,
  type PinterestSelection,
} from "./pinterest-media.ts";
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

const fx = (name: string) => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");
const CAROUSEL_ID = "50595195810299403";
const CAROUSEL_URL = `https://www.pinterest.com/pin/${CAROUSEL_ID}/`;
const CAROUSEL_REDUX = fx("pinterest-carousel-redux.html");
const CAROUSEL_RELAY = fx("pinterest-carousel-relay.html");
const PIN_RESOURCE = JSON.parse(fx("pinterest-pinresource-carousel.json"));
// The four slot videos, in Pinterest's own carousel order.
const SLOT_HASHES = [
  "54206c24314e1aacc52fac1a570ee863",
  "e3e8366da77a14e9383af1b2431c7bd8",
  "7a9c06a6f38a84d397b526a8b9d8c66c",
  "f6b69362bfe081a4b8dbf834b5db6e08",
];

// Genuine file signatures, so assertions are about BYTES, not labels.
const MP4 = (tag: string) => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.from(tag)]);
const JPEG = (tag: string) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(tag)]);
const isMp4 = (b: Buffer) => b.subarray(4, 8).toString("latin1") === "ftyp";
const isJpeg = (b: Buffer) => b[0] === 0xff && b[1] === 0xd8;

// Fake CDN: *.mp4 on pinimg -> MP4, *.m3u8 -> HLS playlist, i.pinimg.com -> JPEG.
function fakeNet(overrides: Record<string, "missing" | "too_large"> = {}) {
  const calls: { url: string; typePrefix: string }[] = [];
  const fetchMedia: MediaFetcher = async (url, typePrefix) => {
    calls.push({ url, typePrefix });
    if (overrides[url] === "missing") return { ok: false, reason: "unavailable" };
    if (overrides[url] === "too_large") return { ok: false, reason: "too_large" };
    const path = new URL(url).pathname;
    const type = path.endsWith(".mp4") ? "video/mp4" : path.endsWith(".m3u8") ? "application/x-mpegurl" : "image/jpeg";
    if (!type.startsWith(typePrefix)) return { ok: false, reason: "wrong_type" };
    const tag = path.split("/").pop()!;
    return { ok: true, buffer: type === "video/mp4" ? MP4(tag) : JPEG(tag), contentType: type, finalUrl: url };
  };
  return { fetchMedia, calls };
}

function fakeEndpoint(response: unknown | (() => Promise<unknown>)) {
  const calls: string[] = [];
  const fetchPinResource: PinResourceFetcher = async (pinId) => {
    calls.push(pinId);
    return typeof response === "function" ? (response as () => Promise<unknown>)() : response;
  };
  return { fetchPinResource, calls };
}

async function run(
  html: string,
  url: string,
  opts: { selection?: PinterestSelection; endpoint?: unknown | (() => Promise<unknown>); net?: Record<string, "missing" | "too_large"> } = {},
) {
  const net = fakeNet(opts.net);
  const ep = fakeEndpoint("endpoint" in opts ? opts.endpoint : PIN_RESOURCE);
  const pinId = new URL(url).pathname.match(/\/pin\/(?:[^/]*?-)?(\d{6,})\/?/)?.[1] ?? null;
  const result = await resolvePinterestPin({
    html,
    pageUrl: url,
    pinId,
    declaredOgVideoUrl: null,
    selection: opts.selection,
    fetchMedia: net.fetchMedia,
    fetchPinResource: ep.fetchPinResource,
  });
  return { result, mediaCalls: net.calls, endpointCalls: ep.calls };
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

// ---------------------------------------------------------------------------
// Single-media Pins: direct import, no picker, NO endpoint call.
// ---------------------------------------------------------------------------

await test("single image Pin -> not handled here (existing og:image path imports it), endpoint never called", async () => {
  const r = await run(fx("pinterest-image-pin.html"), "https://www.pinterest.com/pin/499055202483639919/");
  assert.equal(r.result.kind, "not_handled");
  assert.deepEqual(r.endpointCalls, []);
  assert.deepEqual(r.mediaCalls, []);
});

await test("single video Pin (VideoObject) -> the real MP4 directly, endpoint never called", async () => {
  const r = await run(fx("pinterest-video-pin.html"), "https://www.pinterest.com/pin/788411478524198894/");
  assert.equal(r.result.kind, "video");
  if (r.result.kind === "video") assert.ok(isMp4(r.result.buffer));
  assert.deepEqual(r.endpointCalls, []);
});

await test("single video Pin served in RELAY format with no VideoObject -> MP4 from the Pin's own relay entry", async () => {
  const relayOnly = fx("pinterest-video-relay.html").replace(/<script[^>]*application\/ld\+json[^>]*>[\s\S]*?<\/script>/g, "");
  const r = await run(relayOnly, "https://www.pinterest.com/pin/788411478524198894/");
  assert.equal(r.result.kind, "video");
  if (r.result.kind === "video") {
    assert.ok(isMp4(r.result.buffer));
    assert.match(r.result.fileName, /634598901dec1f6d81a04ced95b7d183\.mp4$/);
  }
  assert.deepEqual(r.endpointCalls, []);
});

await test("video RE-PIN -> the real MP4, endpoint never called", async () => {
  const r = await run(fx("pinterest-video-repin.html"), "https://www.pinterest.com/pin/788411478522345343/");
  assert.equal(r.result.kind, "video");
  if (r.result.kind === "video") assert.ok(isMp4(r.result.buffer));
  assert.deepEqual(r.endpointCalls, []);
});

// ---------------------------------------------------------------------------
// The real carousel Pin (4 videos).
// ---------------------------------------------------------------------------

function assertFourVideoChoices(result: Awaited<ReturnType<typeof run>>["result"]) {
  assert.equal(result.kind, "choose");
  if (result.kind !== "choose") return;
  assert.equal(result.choices.length, 4);
  assert.deepEqual(result.choices.map((c) => c.index), [0, 1, 2, 3], "Pinterest's own order");
  assert.ok(result.choices.every((c) => c.type === "video"), "all four are videos");
  assert.deepEqual(result.choices.map((c) => c.durationMs), [7467, 10800, 10067, 10067], "durations for the badges");
  assert.ok(result.choices.every((c) => c.previewUrl && new URL(c.previewUrl).hostname === "i.pinimg.com"));
  // Choices carry previews only -- no MP4/media URL reaches the browser.
  assert.doesNotMatch(JSON.stringify(result.choices), /\.mp4|\.m3u8|v1\.pinimg\.com/);
}

await test("carousel, REDUX page (per-slot data present) -> 4 video choices, page data only: endpoint NOT called", async () => {
  const r = await run(CAROUSEL_REDUX, CAROUSEL_URL);
  assertFourVideoChoices(r.result);
  assert.deepEqual(r.endpointCalls, []);
  assert.deepEqual(r.mediaCalls, [], "nothing downloaded -- nothing can be persisted before a choice");
});

await test("carousel, RELAY page (slots carry no video data) -> exactly ONE endpoint call for the requested Pin id -> 4 video choices", async () => {
  const pageOnly = pinMediaFromPage(CAROUSEL_RELAY, CAROUSEL_ID);
  assert.deepEqual(pageOnly?.media, { layout: "multi", items: [], perItemTypesKnown: false }, "relay page can't say what slots are");
  const r = await run(CAROUSEL_RELAY, CAROUSEL_URL);
  assertFourVideoChoices(r.result);
  assert.deepEqual(r.endpointCalls, [CAROUSEL_ID]);
  assert.deepEqual(r.mediaCalls, []);
});

for (const [index, hash] of SLOT_HASHES.entries()) {
  await test(`select slot ${index + 1} -> ONLY that slot's MP4 is fetched and returned; its thumbnail is only the poster`, async () => {
    const r = await run(CAROUSEL_RELAY, CAROUSEL_URL, { selection: { index, count: 4 } });
    assert.equal(r.result.kind, "video");
    if (r.result.kind !== "video") return;
    assert.ok(isMp4(r.result.buffer), "primary bytes are MP4");
    assert.match(r.result.fileName, new RegExp(`${hash}_720w\\.mp4$`));
    assert.ok(r.result.poster && isJpeg(r.result.poster.buffer));
    const videoCalls = r.mediaCalls.filter((c) => c.typePrefix === "video/");
    assert.deepEqual(videoCalls.map((c) => new URL(c.url).pathname.split("/").pop()), [`${hash}_720w.mp4`], "no other slot touched");
    assert.ok(r.mediaCalls.every((c) => c.url.includes(hash)), "nothing from other slots fetched");
    assert.ok(!r.mediaCalls.some((c) => /\.m3u8$/.test(c.url)), "HLS never used");
  });
}

await test("selected video flows into the existing Brief video representation: MP4 original + JPEG poster, kind video", async () => {
  const r = await run(CAROUSEL_REDUX, CAROUSEL_URL, { selection: { index: 2, count: 4 } });
  assert.equal(r.result.kind, "video");
  if (r.result.kind !== "video") return;
  let n = 0;
  const plan = planBriefMediaImport({
    projectId: "p",
    kind: "video",
    primary: { buffer: r.result.buffer, contentType: r.result.contentType },
    primaryExt: "mp4",
    poster: r.result.poster ? { ...r.result.poster, ext: "jpg" } : null,
    newId: () => `id${++n}`,
  });
  assert.equal(plan.itemKind, "video");
  assert.ok(isMp4(plan.original.buffer));
  assert.ok(plan.poster && isJpeg(plan.poster.buffer));
  assert.doesNotMatch(JSON.stringify([plan.original.path, plan.poster?.path]), /pinterest|https?:/, "no link back to Pinterest");
});

// ---------------------------------------------------------------------------
// Mixed image/video carousel (fixture-derived: slot 2 turned into an image).
// ---------------------------------------------------------------------------

const MIXED = clone(PIN_RESOURCE);
MIXED.resource_response.data.carousel_data.carousel_slots[1].videos = null;

await test("mixed carousel -> choices keep order and types (video, image, video, video)", async () => {
  const r = await run(CAROUSEL_RELAY, CAROUSEL_URL, { endpoint: MIXED });
  assert.equal(r.result.kind, "choose");
  if (r.result.kind === "choose") {
    assert.deepEqual(r.result.choices.map((c) => c.type), ["video", "image", "video", "video"]);
    assert.equal(r.result.choices[1].durationMs, null);
  }
});

await test("mixed carousel: selecting the IMAGE slot imports that slot's actual image (image/*), nothing else", async () => {
  const r = await run(CAROUSEL_RELAY, CAROUSEL_URL, { endpoint: MIXED, selection: { index: 1, count: 4 } });
  assert.equal(r.result.kind, "image");
  if (r.result.kind === "image") {
    assert.ok(isJpeg(r.result.buffer));
    assert.match(r.result.contentType, /^image\//);
  }
  assert.deepEqual(r.mediaCalls.map((c) => c.typePrefix), ["image/"]);
  assert.ok(r.mediaCalls[0].url.includes("i.pinimg.com"));
});

await test("mixed carousel: selecting a VIDEO slot still imports its MP4", async () => {
  const r = await run(CAROUSEL_RELAY, CAROUSEL_URL, { endpoint: MIXED, selection: { index: 0, count: 4 } });
  assert.equal(r.result.kind, "video");
  if (r.result.kind === "video") assert.ok(isMp4(r.result.buffer));
});

// ---------------------------------------------------------------------------
// Fallback endpoint failures -> safe error, nothing imported, no thumbnail.
// ---------------------------------------------------------------------------

const UNSAFE: [string, unknown | (() => Promise<unknown>)][] = [
  ["unavailable / disabled / 403 / 429 (fetcher returns null)", null],
  ["timeout (fetcher rejects)", () => Promise.reject(new Error("timeout"))],
  ["malformed: not JSON-shaped", "<html>blocked</html>"],
  ["malformed: empty object", {}],
  ["malformed: data without id", { resource_response: { data: { carousel_data: PIN_RESOURCE.resource_response.data.carousel_data } } }],
  ["malformed: numeric id", { resource_response: { data: { ...PIN_RESOURCE.resource_response.data, id: Number(CAROUSEL_ID) } } }],
  ["MISMATCHED Pin id (a different Pin's carousel)", { resource_response: { data: { ...PIN_RESOURCE.resource_response.data, id: "999999999999" } } }],
  ["unrecognized slot shape", (() => { const b = clone(PIN_RESOURCE); b.resource_response.data.carousel_data.carousel_slots[3] = { weird: true }; return b; })()],
  ["endpoint now says single-media", (() => { const b = clone(PIN_RESOURCE); b.resource_response.data.carousel_data = null; return b; })()],
];
for (const [name, endpoint] of UNSAFE) {
  await test(`fallback ${name} -> clear error, no choices, nothing fetched`, async () => {
    const r = await run(CAROUSEL_RELAY, CAROUSEL_URL, { endpoint });
    assert.deepEqual(r.result, { kind: "error", message: PINTEREST_ITEMS_UNAVAILABLE_MESSAGE });
    assert.deepEqual(r.mediaCalls, [], "no thumbnail or anything else downloaded");
    assert.equal(r.endpointCalls.length, 1, "exactly one attempt");
  });
}

await test("mismatched id is rejected by the parser itself", () => {
  assert.equal(pinMediaFromPinResource(PIN_RESOURCE, "123456789"), null);
  assert.ok(pinMediaFromPinResource(PIN_RESOURCE, CAROUSEL_ID));
});

// ---------------------------------------------------------------------------
// Video failures on a selected slot -> error, never the thumbnail.
// ---------------------------------------------------------------------------

await test("selected slot with NO usable MP4 (HLS + HEVC only) -> error, thumbnail never imported", async () => {
  const noMp4 = clone(PIN_RESOURCE);
  const list = noMp4.resource_response.data.carousel_data.carousel_slots[0].videos.video_list;
  list.V_720P.url = list.V_720P.url.replace("/expMp4/", "/hevcMp4/");
  const r = await run(CAROUSEL_RELAY, CAROUSEL_URL, { endpoint: noMp4, selection: { index: 0, count: 4 } });
  assert.deepEqual(r.result, { kind: "error", message: PINTEREST_VIDEO_UNAVAILABLE_MESSAGE });
  assert.ok(!r.mediaCalls.some((c) => c.typePrefix === "image/"), "no image fetched as a substitute");
});

await test("selected slot whose MP4 download fails -> error, thumbnail never imported", async () => {
  const mp4 = `https://v1.pinimg.com/videos/iht/expMp4/7a/9c/06/${SLOT_HASHES[2]}_720w.mp4`;
  const r = await run(CAROUSEL_REDUX, CAROUSEL_URL, { selection: { index: 2, count: 4 }, net: { [mp4]: "missing" } });
  assert.equal(r.result.kind, "error");
  assert.ok(!r.mediaCalls.some((c) => c.typePrefix === "image/"));
});

// ---------------------------------------------------------------------------
// Selection integrity & scoping.
// ---------------------------------------------------------------------------

await test("selection that no longer matches the Pin (count changed / out of range / single Pin) -> 'Pin has changed', nothing imported", async () => {
  for (const selection of [{ index: 0, count: 3 }, { index: 4, count: 4 }, { index: -1, count: 4 }, { index: 1.5, count: 4 }]) {
    const r = await run(CAROUSEL_REDUX, CAROUSEL_URL, { selection });
    assert.deepEqual(r.result, { kind: "error", message: PINTEREST_PIN_CHANGED_MESSAGE }, JSON.stringify(selection));
    assert.deepEqual(r.mediaCalls, []);
  }
  const single = await run(fx("pinterest-video-pin.html"), "https://www.pinterest.com/pin/788411478524198894/", { selection: { index: 0, count: 4 } });
  assert.deepEqual(single.result, { kind: "error", message: PINTEREST_PIN_CHANGED_MESSAGE });
});

await test("related Pins can't leak: other entries in the REDUX store and other relay queries are ignored", async () => {
  const relatedId = "111111111111111";
  const relatedPin = { ...clone(PIN_RESOURCE.resource_response.data), id: relatedId };
  // Image Pin page + a related VIDEO CAROUSEL Pin in the same page store and
  // a relay block for it: the requested image Pin must stay an image Pin.
  const leaky =
    fx("pinterest-image-pin.html") +
    `<script id="__PWS_INITIAL_PROPS__" type="application/json">${JSON.stringify({ initialReduxState: { pins: { [relatedId]: relatedPin } } })}</script>` +
    `<script>window.__PWS_RELAY_REGISTER_COMPLETED_REQUEST__("${encodeURIComponent(JSON.stringify({ variables: { pinId: relatedId } }))}", ${JSON.stringify({ data: { q: { data: { entityId: relatedId, carouselData: { carouselSlots: [{}, {}] } } } } })})</script>`;
  assert.equal(pinMediaFromPage(leaky, "499055202483639919"), null);
  const r = await run(leaky, "https://www.pinterest.com/pin/499055202483639919/");
  assert.equal(r.result.kind, "not_handled");
  assert.deepEqual(r.endpointCalls, [], "a related Pin's carousel never triggers the endpoint");
  assert.deepEqual(r.mediaCalls, []);
});

await test("a relay block is used only when BOTH request pinId and response entityId match", () => {
  const block = (pinId: string, entityId: string) =>
    `<script>window.__PWS_RELAY_REGISTER_COMPLETED_REQUEST__("${encodeURIComponent(JSON.stringify({ variables: { pinId } }))}", ${JSON.stringify({ data: { q: { data: { entityId, videos: { videoList: { v720P: { url: "https://v1.pinimg.com/videos/x.mp4" } } } } } } })})</script>`;
  assert.equal(pinMediaFromPage(block("123456789", "987654321"), "123456789"), null);
  assert.equal(pinMediaFromPage(block("987654321", "123456789"), "123456789"), null);
  assert.equal(pinMediaFromPage(block("123456789", "123456789"), "123456789")?.media.layout, "single");
});

await test("media URLs from Pin data must be https on pinimg.com (anything else is dropped)", async () => {
  const evil = clone(PIN_RESOURCE);
  evil.resource_response.data.carousel_data.carousel_slots[0].videos.video_list.V_720P.url = "https://evil.example/x.mp4";
  const r = await run(CAROUSEL_RELAY, CAROUSEL_URL, { endpoint: evil, selection: { index: 0, count: 4 } });
  assert.equal(r.result.kind, "error");
  assert.ok(!r.mediaCalls.some((c) => c.url.includes("evil.example")));
});

await test("Idea Pin with several pages -> picker over its pages (video page -> MP4, image page -> image)", async () => {
  const story = {
    resource_response: {
      data: {
        id: "222222222222",
        story_pin_data: {
          pages: [
            { blocks: [{ video: { video_list: { V_720P: { url: "https://v1.pinimg.com/videos/a.mp4", duration: 5000, thumbnail: "https://i.pinimg.com/t/a.jpg" } } } }] },
            { blocks: [{ image: { images: { "236x": { url: "https://i.pinimg.com/236x/b.jpg", width: 236 }, originals: { url: "https://i.pinimg.com/originals/b.jpg", width: 1000 } } } }] },
          ],
        },
      },
    },
  };
  const relayStory = `<script>window.__PWS_RELAY_REGISTER_COMPLETED_REQUEST__("${encodeURIComponent(JSON.stringify({ variables: { pinId: "222222222222" } }))}", ${JSON.stringify({ data: { q: { data: { entityId: "222222222222", storyPinData: { pages: [{}, {}] } } } } })})</script>`;
  const r = await run(relayStory, "https://www.pinterest.com/pin/222222222222/", { endpoint: story });
  assert.equal(r.result.kind, "choose");
  if (r.result.kind === "choose") assert.deepEqual(r.result.choices.map((c) => c.type), ["video", "image"]);
  const pick = await run(relayStory, "https://www.pinterest.com/pin/222222222222/", { endpoint: story, selection: { index: 1, count: 2 } });
  assert.equal(pick.result.kind, "image");
});

console.log(`\n${passed} passed`);
