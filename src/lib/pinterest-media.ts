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
  const pinId = pinIdFromUrl(pageUrl);
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
      // A VideoObject that explicitly names a DIFFERENT pin isn't this pin's.
      const nodeId = [node["@id"], node["url"]].map((v) => (typeof v === "string" ? pinIdFromUrl(v) : null)).find(Boolean);
      if (pinId && nodeId && nodeId !== pinId) continue;
      sawVideoObject = true;
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
