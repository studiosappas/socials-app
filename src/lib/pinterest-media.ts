// Pinterest pin -> video detection for the external-media resolver
// (external-media-resolver.ts, whose only caller is Brief's addBriefTaskLink).
//
// Why this exists: a Pinterest VIDEO pin's page publishes only og:image --
// and that og:image is the video's POSTER frame. There is no og:video and no
// twitter:player:stream (verified against live pin pages, 2026-09-30), so the
// generic resolver found no declared video, fell through to og:image, and
// imported the poster JPEG as a static image. What a video pin page DOES
// publish is a standard schema.org VideoObject in a JSON-LD block, carrying
// the playable file (contentUrl, a direct H.264 .mp4) and the poster
// (thumbnailUrl). Image pins carry no VideoObject at all (only a
// SocialMediaPosting), so its presence is the video/image discriminator.
//
// Deliberately NOT read: Pinterest's own app-state JSON (__PWS_DATA__ etc.).
// It is undocumented, and a pin page embeds RELATED pins' data too -- a video
// URL found there may belong to a different pin entirely.
//
// Pure (no network, no "@/" imports) -- fetching is injected, so
// pinterest-media.test.ts runs fully offline against captured fixtures.

// pinterest.com plus its country domains/subdomains (www., in., uk.,
// pinterest.co.uk, pinterest.com.au, pinterest.de, ...). pin.it short links
// are handled by the caller checking the FINAL url after redirects.
export function isPinterestHost(hostname: string): boolean {
  return /(^|\.)pinterest\.(com|[a-z]{2,3}|co\.[a-z]{2}|com\.[a-z]{2})$/i.test(hostname);
}

// /pin/{id}/ and /pin/{slug}--{id}/ -- the trailing digits are the pin id.
export function pinIdFromUrl(url: string): string | null {
  try {
    const match = new URL(url).pathname.match(/\/pin\/(?:[^/]*?-)?(\d{6,})\/?/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export type PinterestVideoMetadata = {
  // The pin declares itself a video (VideoObject or og:video), whether or not
  // a usable file URL could be found -- this is what forbids the image
  // fallback.
  isVideo: boolean;
  // Candidate playable files, best first. May be empty even when isVideo.
  videoUrls: string[];
  // Poster/preview frame -- never a primary-asset candidate.
  posterUrl: string | null;
};

type JsonNode = Record<string, unknown>;

function toAbsoluteHttpUrl(value: unknown, pageUrl: string): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim(), pageUrl);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
}

// Every object node in a JSON-LD document: top-level arrays and @graph
// containers are flattened (both are valid, common JSON-LD shapes).
function jsonLdNodes(doc: unknown): JsonNode[] {
  const out: JsonNode[] = [];
  for (const entry of asArray(doc)) {
    if (!entry || typeof entry !== "object") continue;
    const node = entry as JsonNode;
    out.push(node);
    if (node["@graph"]) out.push(...jsonLdNodes(node["@graph"]));
  }
  return out;
}

function isVideoObject(node: JsonNode): boolean {
  return asArray(node["@type"]).some((t) => typeof t === "string" && /(^|\/)VideoObject$/.test(t));
}

function metaContent(html: string, property: string): string | null {
  const p = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match =
    html.match(new RegExp(`<meta[^>]+property=["']${p}["'][^>]+content=["']([^"']+)["']`, "i")) ??
    html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${p}["']`, "i"));
  return match?.[1] ?? null;
}

function decodeBasicEntities(text: string): string {
  return text.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

// `declaredOgVideoUrl` is the generic og:video/twitter:player:stream result
// the resolver already extracts -- passed in rather than re-parsed here.
export function extractPinterestVideoMetadata(
  html: string,
  pageUrl: string,
  declaredOgVideoUrl: string | null,
): PinterestVideoMetadata {
  // Every id this page legitimately answers to. A RE-PIN's page (the common
  // case -- most pins a user saves or pastes are re-pins) describes the
  // ORIGINAL pin: its og:url, canonical link and VideoObject @id all carry
  // the original pin's id, not the id in the pasted URL. Verified live
  // 2026-10-01: e.g. /pin/788411478522345343/ -> og:url + VideoObject @id
  // /pin/140806229581762/. The first version of this module compared only
  // against the pasted URL's id, rejected every re-pin's VideoObject as
  // "another pin's", and fell back to the poster -- the QA failure.
  const pageIds = new Set(
    [
      pageUrl,
      metaContent(html, "og:url"),
      html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1] ?? null,
      html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i)?.[1] ?? null,
    ]
      .map((u) => {
        if (!u) return null;
        try {
          return pinIdFromUrl(new URL(u, pageUrl).toString());
        } catch {
          return null;
        }
      })
      .filter((id): id is string => Boolean(id)),
  );
  const videoUrls: string[] = [];
  let posterUrl: string | null = null;
  let sawVideoObject = false;

  for (const match of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let doc: unknown;
    try {
      doc = JSON.parse(match[1]);
    } catch {
      try {
        doc = JSON.parse(decodeBasicEntities(match[1]));
      } catch {
        continue;
      }
    }
    for (const node of jsonLdNodes(doc)) {
      if (!isVideoObject(node)) continue;
      // Any VideoObject on a pin page means this pin is a video -- so even
      // one whose identity can't be matched still forbids the image
      // fallback (it becomes an error instead). Its FILE is only trusted
      // when it names one of this page's own ids, or names no pin at all.
      sawVideoObject = true;
      const nodeId = [node["@id"], node["url"]].map((v) => (typeof v === "string" ? pinIdFromUrl(v) : null)).find(Boolean);
      if (nodeId && pageIds.size > 0 && !pageIds.has(nodeId)) continue;
      for (const candidate of asArray(node["contentUrl"])) {
        const url = toAbsoluteHttpUrl(candidate, pageUrl);
        if (url && !videoUrls.includes(url)) videoUrls.push(url);
      }
      if (!posterUrl) {
        for (const thumb of asArray(node["thumbnailUrl"])) {
          const url = toAbsoluteHttpUrl(typeof thumb === "object" && thumb ? (thumb as JsonNode)["url"] : thumb, pageUrl);
          if (url) {
            posterUrl = url;
            break;
          }
        }
      }
    }
  }

  if (declaredOgVideoUrl && !videoUrls.includes(declaredOgVideoUrl)) videoUrls.push(declaredOgVideoUrl);
  return { isVideo: sawVideoObject || declaredOgVideoUrl !== null, videoUrls, posterUrl };
}

export type FetchedMedia = { ok: true; buffer: Buffer; contentType: string; finalUrl: string } | { ok: false; reason: "too_large" | "wrong_type" | "unavailable" };

// Fetches `url` and returns its bytes ONLY if the response's own
// Content-Type starts with `typePrefix` ("video/" or "image/") and it fits
// the size ceiling -- the resolver supplies the real SSRF-safe
// implementation; tests supply fakes.
export type MediaFetcher = (url: string, typePrefix: "video/" | "image/") => Promise<FetchedMedia>;

export type PinterestVideoResolution =
  | { kind: "not_video" }
  | {
      kind: "video";
      buffer: Buffer;
      contentType: string;
      fileName: string;
      poster: { buffer: Buffer; contentType: string } | null;
    }
  | { kind: "error"; message: string };

export const PINTEREST_VIDEO_TOO_LARGE_MESSAGE =
  "This Pinterest video is too large to import. Try downloading it and uploading the video file instead.";
export const PINTEREST_VIDEO_UNAVAILABLE_MESSAGE =
  "This Pinterest video couldn't be imported. Try downloading it and uploading the video file instead.";

function fileNameFromUrl(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").pop() || "video.mp4");
  } catch {
    return "video.mp4";
  }
}

// not_video -> the caller continues with its existing (image) behavior.
// video     -> a real, playable video file; the poster is extra, optional.
// error     -> the pin IS a video but no playable file could be obtained
//              (HLS-only, blocked, too large...). Never degrades to the
//              poster image.
export async function resolvePinterestVideo(meta: PinterestVideoMetadata, fetchMedia: MediaFetcher): Promise<PinterestVideoResolution> {
  if (!meta.isVideo) return { kind: "not_video" };

  let sawTooLarge = false;
  for (const url of meta.videoUrls) {
    const video = await fetchMedia(url, "video/");
    if (!video.ok) {
      if (video.reason === "too_large") sawTooLarge = true;
      continue;
    }
    let poster: { buffer: Buffer; contentType: string } | null = null;
    if (meta.posterUrl) {
      // Best-effort: a missing poster never costs the user the video.
      const fetched = await fetchMedia(meta.posterUrl, "image/").catch(() => null);
      if (fetched?.ok) poster = { buffer: fetched.buffer, contentType: fetched.contentType };
    }
    return { kind: "video", buffer: video.buffer, contentType: video.contentType, fileName: fileNameFromUrl(video.finalUrl), poster };
  }

  return { kind: "error", message: sawTooLarge ? PINTEREST_VIDEO_TOO_LARGE_MESSAGE : PINTEREST_VIDEO_UNAVAILABLE_MESSAGE };
}

// ===========================================================================
// Pin data -> media items (carousels, Idea Pin pages, single media).
//
// Approved 2026-10-02 ("Option 2"). Some video Pins -- notably CAROUSELS of
// videos -- publish no VideoObject at all (the Pin itself reports
// is_video:false); their media only exists in the Pin's own entry inside
// Pinterest's page data. That data comes in two formats, and which one a
// request gets varies between requests for the same Pin (measured: ~1 in 10):
//
//   REDUX  -- <script id="__PWS_INITIAL_PROPS__">, initialReduxState.pins[id],
//             snake_case; carousel slots include their videos.
//   RELAY  -- __PWS_RELAY_REGISTER_COMPLETED_REQUEST__("<request>", <json>)
//             calls, camelCase; carousel slots carry ONLY image fields -- a
//             video slot is indistinguishable from an image slot there.
//
// When the page can't say what each slot is, ONE request to Pinterest's
// internal PinResource endpoint (same snake_case shape as REDUX) supplies it
// -- see lib/pinterest-pin-resource.ts, injected here as fetchPinResource.
//
// Scoping (never scan arbitrary entries): REDUX is read only at
// pins[<requested id>]; a RELAY block is used only when its request's
// variables.pinId AND its response's entityId both equal the requested id;
// a PinResource response only when resource_response.data.id equals it.
// Related/recommended Pins on the same page are never read.
//
// Defensive by construction: every field is type-checked; any shape this
// code doesn't recognize makes the Pin "unknown" -> a clear error, never a
// guess. Media URLs taken from Pin data must be https on *.pinimg.com.
// ===========================================================================

export type PinterestMediaItem =
  | { type: "video"; mp4Urls: string[]; posterUrl: string | null; previewUrl: string | null; durationMs: number | null }
  | { type: "image"; imageUrl: string; previewUrl: string | null };

export type PinterestPinMedia =
  | { layout: "single"; item: PinterestMediaItem | null }
  // perItemTypesKnown=false: the Pin has several items but this source can't
  // say which are videos (RELAY carousels) -- must not be offered or imported.
  | { layout: "multi"; items: PinterestMediaItem[]; perItemTypesKnown: boolean };

// What the picker shows -- deliberately no media URLs beyond a preview image;
// the server re-resolves the chosen item from the Pin itself.
export type PinterestChoice = { index: number; type: "video" | "image"; previewUrl: string | null; durationMs: number | null };

const MAX_PIN_ITEMS = 50;

function isObj(v: unknown): v is JsonNode {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function pinimgUrl(v: unknown): string | null {
  if (typeof v !== "string") return null;
  try {
    const url = new URL(v);
    return url.protocol === "https:" && /(^|\.)pinimg\.com$/i.test(url.hostname) ? url.toString() : null;
  } catch {
    return null;
  }
}

// H.264 progressive MP4 only: HLS playlists (.m3u8) aren't a storable file,
// and Pinterest's "hevc" variants don't play in every browser.
function isPlayableMp4(url: string): boolean {
  const path = new URL(url).pathname.toLowerCase();
  return path.endsWith(".mp4") && !path.includes("hevc");
}

// A video_list / videoList object: { V_720P: {url,width,height,duration,thumbnail}, V_HLSV4: {...}, __typename: "..." }
function videoFromList(list: JsonNode, previewUrl: string | null): PinterestMediaItem {
  const entries = Object.entries(list)
    .filter((e): e is [string, JsonNode] => isObj(e[1]))
    .map(([key, v]) => ({ key, v, url: pinimgUrl(v.url) }));
  const mp4 = entries
    .filter((e): e is typeof e & { url: string } => !!e.url && isPlayableMp4(e.url))
    .sort((a, b) => {
      const a720 = /720/.test(a.key) ? 1 : 0;
      const b720 = /720/.test(b.key) ? 1 : 0;
      if (a720 !== b720) return b720 - a720;
      return (Number(b.v.height) || 0) - (Number(a.v.height) || 0);
    });
  const withThumb = [...mp4, ...entries].find((e) => pinimgUrl(e.v.thumbnail));
  const withDuration = [...mp4, ...entries].find((e) => typeof e.v.duration === "number" && e.v.duration > 0);
  return {
    type: "video",
    mp4Urls: [...new Set(mp4.map((e) => e.url))],
    posterUrl: withThumb ? pinimgUrl(withThumb.v.thumbnail) : null,
    // Small cover image for the picker when there is one; else the poster.
    previewUrl: previewUrl ?? (withThumb ? pinimgUrl(withThumb.v.thumbnail) : null),
    durationMs: withDuration ? Number(withDuration.v.duration) : null,
  };
}

// snake_case images map: { "236x": {url,width,height}, ..., orig: {...} }
function snakeImages(images: unknown): { full: string | null; preview: string | null } {
  if (!isObj(images)) return { full: null, preview: null };
  const at = (k: string) => (isObj(images[k]) ? pinimgUrl(images[k].url) : null);
  const largest = Object.values(images)
    .filter(isObj)
    .sort((a, b) => (Number(b.width) || 0) - (Number(a.width) || 0))
    .map((v) => pinimgUrl(v.url))
    .find(Boolean);
  return { full: at("orig") ?? largest ?? null, preview: at("236x") ?? at("474x") ?? at("736x") ?? largest ?? null };
}

// camelCase relay images: images_236x, images_736x, imageSpec_orig, ... -> {url}
function camelImages(node: JsonNode): { full: string | null; preview: string | null } {
  const at = (k: string) => (isObj(node[k]) ? pinimgUrl(node[k].url) : null);
  return {
    full: at("imageSpec_orig") ?? at("images_orig") ?? at("images_1200x") ?? at("images_736x"),
    preview: at("images_236x") ?? at("imageSpec_236x") ?? at("images_474x") ?? at("images_736x"),
  };
}

// Deep search for the first object under `key`, confined to ONE subtree (an
// Idea Pin page) -- never applied to a whole page.
function findWithin(node: unknown, key: string, depth = 0): JsonNode | null {
  if (depth > 8 || !node || typeof node !== "object") return null;
  if (isObj(node) && isObj(node[key])) return node[key];
  for (const v of Object.values(node)) {
    const hit = findWithin(v, key, depth + 1);
    if (hit) return hit;
  }
  return null;
}

// REDUX page entry and PinResource data share this snake_case shape.
export function mediaFromSnakePin(pin: JsonNode): PinterestPinMedia {
  const carousel = isObj(pin.carousel_data) ? pin.carousel_data.carousel_slots : null;
  if (Array.isArray(carousel) && carousel.length >= 2) {
    const items = carousel.slice(0, MAX_PIN_ITEMS).map((slot): PinterestMediaItem | null => {
      if (!isObj(slot)) return null;
      const img = snakeImages(slot.images);
      if (isObj(slot.videos) && isObj(slot.videos.video_list)) return videoFromList(slot.videos.video_list, img.preview);
      return img.full ? { type: "image", imageUrl: img.full, previewUrl: img.preview } : null;
    });
    return items.every(Boolean)
      ? { layout: "multi", items: items as PinterestMediaItem[], perItemTypesKnown: true }
      : { layout: "multi", items: [], perItemTypesKnown: false };
  }

  const pages = isObj(pin.story_pin_data) ? pin.story_pin_data.pages : null;
  if (Array.isArray(pages) && pages.length >= 2) {
    const items = pages.slice(0, MAX_PIN_ITEMS).map((page): PinterestMediaItem | null => {
      const videoList = findWithin(page, "video_list");
      const img = snakeImages(findWithin(page, "images"));
      if (videoList) return videoFromList(videoList, img.preview);
      return img.full ? { type: "image", imageUrl: img.full, previewUrl: img.preview } : null;
    });
    return items.every(Boolean)
      ? { layout: "multi", items: items as PinterestMediaItem[], perItemTypesKnown: true }
      : { layout: "multi", items: [], perItemTypesKnown: false };
  }

  const img = snakeImages(pin.images);
  if (isObj(pin.videos) && isObj(pin.videos.video_list)) return { layout: "single", item: videoFromList(pin.videos.video_list, img.preview) };
  const singlePageVideo = Array.isArray(pages) && pages.length === 1 ? findWithin(pages[0], "video_list") : null;
  if (singlePageVideo) return { layout: "single", item: videoFromList(singlePageVideo, img.preview) };
  return { layout: "single", item: img.full ? { type: "image", imageUrl: img.full, previewUrl: img.preview } : null };
}

// RELAY page entry (camelCase). Its carousel slots never carry video data, so
// a slot only counts as known when it explicitly has videos.videoList.
export function mediaFromCamelPin(pin: JsonNode): PinterestPinMedia {
  const carousel = isObj(pin.carouselData) ? pin.carouselData.carouselSlots : null;
  if (Array.isArray(carousel) && carousel.length >= 2) {
    const items = carousel.slice(0, MAX_PIN_ITEMS).map((slot): PinterestMediaItem | null => {
      if (!isObj(slot)) return null;
      const img = camelImages(slot);
      return isObj(slot.videos) && isObj(slot.videos.videoList) ? videoFromList(slot.videos.videoList, img.preview) : null;
    });
    return items.every(Boolean)
      ? { layout: "multi", items: items as PinterestMediaItem[], perItemTypesKnown: true }
      : { layout: "multi", items: [], perItemTypesKnown: false };
  }
  const pages = isObj(pin.storyPinData) ? pin.storyPinData.pages : null;
  if (Array.isArray(pages) && pages.length >= 2) return { layout: "multi", items: [], perItemTypesKnown: false };

  const img = camelImages(pin);
  if (isObj(pin.videos) && isObj(pin.videos.videoList)) return { layout: "single", item: videoFromList(pin.videos.videoList, img.preview) };
  return { layout: "single", item: img.full ? { type: "image", imageUrl: img.full, previewUrl: img.preview } : null };
}

// Each relay call: __PWS_RELAY_REGISTER_COMPLETED_REQUEST__("<urlencoded request JSON>", <response JSON>)
export function parseRelayBlocks(html: string): { request: JsonNode; response: JsonNode }[] {
  const out: { request: JsonNode; response: JsonNode }[] = [];
  const re = /__PWS_RELAY_REGISTER_COMPLETED_REQUEST__\(\s*"([^"]*)"\s*,\s*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    let request: unknown;
    try {
      request = JSON.parse(decodeURIComponent(m[1]));
    } catch {
      continue;
    }
    // The response is a JSON object literal -- find its end by brace
    // matching (string-aware), then parse exactly that slice.
    const start = re.lastIndex;
    if (html[start] !== "{") continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
    for (let i = start; i < html.length; i++) {
      const c = html[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === '"') inString = false;
      } else if (c === '"') inString = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) {
        end = i + 1;
        break;
      }
    }
    if (end < 0) continue;
    try {
      const response = JSON.parse(html.slice(start, end));
      if (isObj(request) && isObj(response)) out.push({ request, response });
    } catch {
      // malformed block -- ignored
    }
    re.lastIndex = end;
  }
  return out;
}

// The requested Pin's own entry from the page, if the page carries one.
export function pinMediaFromPage(html: string, pinId: string): { source: "redux" | "relay"; media: PinterestPinMedia } | null {
  const props = html.match(/<script[^>]*id=["']__PWS_INITIAL_PROPS__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (props) {
    try {
      const root: unknown = JSON.parse(props[1]);
      const pins = isObj(root) && isObj(root.initialReduxState) ? root.initialReduxState.pins : null;
      const pin = isObj(pins) ? pins[pinId] : null;
      if (isObj(pin) && pin.id === pinId) return { source: "redux", media: mediaFromSnakePin(pin) };
    } catch {
      // fall through to relay
    }
  }

  const candidates: PinterestPinMedia[] = [];
  for (const { request, response } of parseRelayBlocks(html)) {
    const variables = request.variables;
    if (!isObj(variables) || variables.pinId !== pinId || !isObj(response.data)) continue;
    for (const query of Object.values(response.data)) {
      const data = isObj(query) ? query.data : null;
      if (isObj(data) && data.entityId === pinId) candidates.push(mediaFromCamelPin(data));
    }
  }
  if (candidates.length === 0) return null;
  // Several relay queries describe the same Pin with different field sets:
  // prefer a known multi, then any multi, then a video with a poster, then a video.
  const pick =
    candidates.find((c) => c.layout === "multi" && c.perItemTypesKnown) ??
    candidates.find((c) => c.layout === "multi") ??
    candidates.find((c) => c.layout === "single" && c.item?.type === "video" && c.item.posterUrl) ??
    candidates.find((c) => c.layout === "single" && c.item?.type === "video") ??
    candidates[0];
  return { source: "relay", media: pick };
}

// PinResource JSON -> the requested Pin's media, ONLY if the response is for
// exactly that Pin id. Anything else (malformed, wrong id, error payload) -> null.
export function pinMediaFromPinResource(json: unknown, pinId: string): PinterestPinMedia | null {
  if (!isObj(json) || !isObj(json.resource_response)) return null;
  const data = json.resource_response.data;
  if (!isObj(data) || typeof data.id !== "string" || data.id !== pinId) return null;
  return mediaFromSnakePin(data);
}

// Returns raw PinResource JSON, or null on ANY failure (disabled, network,
// timeout, non-2xx such as 403/429, oversize, unparseable).
export type PinResourceFetcher = (pinId: string) => Promise<unknown | null>;

export type PinterestSelection = { index: number; count: number };

export type PinterestPinResolution =
  | { kind: "not_handled" }
  | { kind: "choose"; choices: PinterestChoice[] }
  | { kind: "video"; buffer: Buffer; contentType: string; fileName: string; poster: { buffer: Buffer; contentType: string } | null }
  | { kind: "image"; buffer: Buffer; contentType: string; fileName: string }
  | { kind: "error"; message: string };

export const PINTEREST_ITEMS_UNAVAILABLE_MESSAGE =
  "This Pinterest Pin's items couldn't be loaded right now. Please try again later, or download the item and upload it instead.";
export const PINTEREST_PIN_CHANGED_MESSAGE = "This Pinterest Pin has changed. Please paste the link again.";
export const PINTEREST_ITEM_UNAVAILABLE_MESSAGE =
  "That item couldn't be imported. Try again, or download it and upload it instead.";

async function importItem(item: PinterestMediaItem, fetchMedia: MediaFetcher): Promise<PinterestPinResolution> {
  if (item.type === "video") {
    const r = await resolvePinterestVideo({ isVideo: true, videoUrls: item.mp4Urls, posterUrl: item.posterUrl }, fetchMedia);
    return r.kind === "not_video" ? { kind: "error", message: PINTEREST_VIDEO_UNAVAILABLE_MESSAGE } : r;
  }
  const image = await fetchMedia(item.imageUrl, "image/").catch(() => null);
  if (!image?.ok) return { kind: "error", message: PINTEREST_ITEM_UNAVAILABLE_MESSAGE };
  return { kind: "image", buffer: image.buffer, contentType: image.contentType, fileName: fileNameFromUrl(image.finalUrl) };
}

// The Pinterest decision for one request. `selection` is present only on the
// second call, after the user picked an item: the Pin is resolved again from
// scratch (nothing from the browser but index/count is trusted).
//
//   not_handled -> the caller's existing flow continues (single IMAGE Pins
//                  keep importing exactly as before).
//   choose      -> several items: show the picker, persist nothing.
//   video/image -> the one item to import.
//   error       -> clear message, persist nothing.
export async function resolvePinterestPin(input: {
  html: string;
  pageUrl: string;
  pinId: string | null;
  declaredOgVideoUrl: string | null;
  selection?: PinterestSelection;
  fetchMedia: MediaFetcher;
  fetchPinResource: PinResourceFetcher;
}): Promise<PinterestPinResolution> {
  const { html, pageUrl, pinId, declaredOgVideoUrl, selection, fetchMedia } = input;
  const page = pinId ? pinMediaFromPage(html, pinId) : null;

  let multi: PinterestMediaItem[] | null = null;
  if (page?.media.layout === "multi") {
    if (page.media.perItemTypesKnown) {
      multi = page.media.items;
    } else {
      // The ONE fallback request -- only reached for a multi-item Pin whose
      // page couldn't say what each item is.
      const json = await input.fetchPinResource(pinId!).catch(() => null);
      const fallback = json === null ? null : pinMediaFromPinResource(json, pinId!);
      if (!fallback || fallback.layout !== "multi" || !fallback.perItemTypesKnown || fallback.items.length === 0) {
        return { kind: "error", message: PINTEREST_ITEMS_UNAVAILABLE_MESSAGE };
      }
      multi = fallback.items;
    }
  }

  if (multi) {
    if (!selection) {
      return {
        kind: "choose",
        choices: multi.map((item, index) => ({
          index,
          type: item.type,
          previewUrl: item.previewUrl,
          durationMs: item.type === "video" ? item.durationMs : null,
        })),
      };
    }
    const { index, count } = selection;
    if (count !== multi.length || !Number.isInteger(index) || index < 0 || index >= multi.length) {
      return { kind: "error", message: PINTEREST_PIN_CHANGED_MESSAGE };
    }
    return importItem(multi[index], fetchMedia);
  }

  // Single-media (or no usable Pin data). A selection here means the Pin no
  // longer has the items the picker showed.
  if (selection) return { kind: "error", message: PINTEREST_PIN_CHANGED_MESSAGE };

  const meta = extractPinterestVideoMetadata(html, pageUrl, declaredOgVideoUrl);
  const pageItem = page?.media.layout === "single" ? page.media.item : null;
  const pageVideo = pageItem?.type === "video" ? pageItem : null;
  const merged: PinterestVideoMetadata = {
    isVideo: meta.isVideo || pageVideo !== null,
    videoUrls: [...new Set([...meta.videoUrls, ...(pageVideo?.mp4Urls ?? [])])],
    posterUrl: meta.posterUrl ?? pageVideo?.posterUrl ?? null,
  };
  const video = await resolvePinterestVideo(merged, fetchMedia);
  return video.kind === "not_video" ? { kind: "not_handled" } : video;
}
