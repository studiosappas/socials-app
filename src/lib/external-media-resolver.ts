import { safeFetch } from "@/lib/safe-fetch";
import { MAX_IMAGE_UPLOAD_SIZE_BYTES } from "@/lib/upload-limits";

// The one real "paste a URL, figure out what it actually is" pipeline in
// the app -- addBriefTaskLink (src/lib/actions/brief.ts) is its only caller
// today, but this deliberately isn't Brief-specific: everything here is
// "given a URL, safely resolve it to real media bytes or admit it's just a
// link," independent of what calls it.
//
// Same size ceiling as a direct upload (upload-limits.ts) -- an external
// fetch shouldn't be allowed to pull in something a real upload wouldn't be
// allowed to keep either.
const MAX_FETCH_BYTES = MAX_IMAGE_UPLOAD_SIZE_BYTES;

// A raw Content-Type header can carry parameters -- "image/jpeg; charset=UTF-8"
// is a real header some image hosts/CDNs send even for binary content, not a
// hypothetical. Every contentType this module hands back is run through this
// first, so nothing downstream (extension derivation, what gets stored as the
// asset's own MIME type) ever sees the raw header with its parameters intact.
function cleanMimeType(rawContentType: string): string {
  return rawContentType.split(";")[0].trim().toLowerCase();
}

// image/jpeg -> jpg (the extension people actually expect, not the "jpeg"
// you'd get from a blind split), plus every other common image/video subtype
// this app already handles. Not exhaustive by hardcoded list alone -- an
// unlisted-but-real subtype still gets a reasonable extension via the
// sanitized-subtype fallback below, so a real image/video type this map
// doesn't happen to name still produces something valid rather than nothing.
const MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/pjpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
  "image/tiff": "tiff",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/avif": "avif",
  "image/x-icon": "ico",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-msvideo": "avi",
  "video/x-matroska": "mkv",
  "video/mpeg": "mpeg",
  "video/ogg": "ogv",
};

// cleanType must already be run through cleanMimeType -- no ";"-parameters,
// already lowercased.
export function extensionForContentType(cleanType: string): string | undefined {
  if (MIME_EXTENSIONS[cleanType]) return MIME_EXTENSIONS[cleanType];
  const subtype = cleanType.split("/")[1];
  if (!subtype) return undefined;
  // Strips a "+xml"-style suffix and an "x-" vendor prefix, then keeps only
  // filename-safe characters -- so a real but unlisted subtype (some other
  // vendor-prefixed or "+xml"-suffixed image/video type) still yields a
  // plain, valid-looking extension instead of smuggling through stray
  // characters a MIME subtype is allowed to have but a filename extension
  // should never contain.
  const safe = subtype
    .replace(/^x-/, "")
    .replace(/\+.*$/, "")
    .replace(/[^a-z0-9]/g, "");
  return safe || undefined;
}

const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&apos;|&nbsp;/g, (entity) => HTML_ENTITIES[entity] ?? entity);
}

// og:title/twitter:title first (a page's own declared social-share title),
// falling back to <title>. Capped at a sane length -- a page's <title> can
// be a long "Product | Category | Store | Free Shipping" string.
export function extractPageTitle(html: string): string | null {
  const patterns = [
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,
    /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:title["']/i,
    /<title[^>]*>([^<]+)<\/title>/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match?.[1]) continue;
    const decoded = decodeHtmlEntities(match[1]).trim();
    if (decoded && decoded.length <= 120) return decoded;
  }
  return null;
}

function resolveUrl(candidate: string, pageUrl: string): string | null {
  try {
    return new URL(candidate, pageUrl).toString();
  } catch {
    return null;
  }
}

// og:image (both attribute orders) then twitter:image -- these are a page's
// own DECLARED share image, i.e. real metadata the site published, not a
// guess. Deliberately does NOT fall back to the first <img> on the page
// (an earlier version did) -- a random in-page image is exactly the kind of
// "wrong asset" mistake this pass exists to fix; a page with no genuine
// og:image/twitter:image now correctly stays a LINK instead of guessing.
function extractDeclaredImageUrl(html: string, pageUrl: string): string | null {
  const patterns = [
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/i,
    /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["']/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      const resolved = resolveUrl(match[1], pageUrl);
      if (resolved) return resolved;
    }
  }
  return null;
}

// og:video/og:video:url/og:video:secure_url, or twitter:player:stream (the
// declared direct video-file URL for a Twitter Player Card) -- same
// "declared metadata only" discipline as extractDeclaredImageUrl.
function extractDeclaredVideoUrl(html: string, pageUrl: string): string | null {
  const patterns = [
    /<meta[^>]+property=["']og:video(?::secure_url|:url)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:video(?::secure_url|:url)?["']/i,
    /<meta[^>]+name=["']twitter:player:stream["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:player:stream["']/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      const resolved = resolveUrl(match[1], pageUrl);
      if (resolved) return resolved;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Provider-specific share-page -> direct-asset URL normalization.
//
// Google Drive and Dropbox both hand out a SHARE PAGE url, not the file
// itself -- fetching that page raw returns an HTML viewer, whose og:image is
// the provider's own generic preview chrome, not the shared file. Both
// providers document a stable, public convention for turning that share url
// into the real file's direct-download url; using that convention (rather
// than scraping the share page's visual HTML) is what actually fixes "the
// wrong image/banner shows up" for these two providers specifically.
//
// Collect has no publicly documented direct-asset URL convention to rewrite
// against (unlike Drive/Dropbox, there's no stable public spec for it), so
// there's no provider-specific rule for it here -- see
// isLikelyGenericSiteImage below for the provider-agnostic fix that targets
// its actual failure mode instead.
// ---------------------------------------------------------------------------
function normalizeProviderUrl(url: URL): URL {
  const host = url.hostname.toLowerCase();

  if (host === "www.dropbox.com" || host === "dropbox.com") {
    // A Dropbox share link's own page is an HTML preview; Dropbox's
    // documented convention is that the SAME path with dl=1 (instead of the
    // default dl=0) redirects straight to the raw file on
    // dl.dropboxusercontent.com with the correct Content-Type -- no
    // scraping required. safeFetch already follows and re-validates that
    // redirect.
    const next = new URL(url.toString());
    next.searchParams.set("dl", "1");
    return next;
  }

  if (host === "drive.google.com") {
    // Standard share-link shapes: /file/d/{ID}/view or an id= query param.
    // Google's documented direct-download convention is
    // uc?export=download&id={ID} -- for a file small enough to skip Drive's
    // virus-scan interstitial, this returns the raw bytes directly. For a
    // large/restricted file it instead returns an HTML confirmation page,
    // which correctly falls through to the plain-link path below (see
    // resolveExternalMedia) rather than pretending to succeed.
    const fileIdMatch = url.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    const fileId = fileIdMatch?.[1] ?? url.searchParams.get("id");
    if (fileId) {
      const next = new URL("https://drive.google.com/uc");
      next.searchParams.set("export", "download");
      next.searchParams.set("id", fileId);
      return next;
    }
  }

  return url;
}

// Reads a response body up to a hard byte ceiling, aborting (not just
// truncating) if it's exceeded -- a Content-Length header can't be trusted
// alone (absent, or wrong), so this caps the actual bytes read regardless of
// what the server claimed.
async function readBodyWithLimit(response: Response, maxBytes: number): Promise<Buffer | null> {
  const reader = response.body?.getReader();
  if (!reader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.byteLength > maxBytes ? null : buffer;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}

// Fetches a page's OWN root ("/") and extracts its declared image, purely to
// compare against a candidate item-page image below -- this is the
// provider-agnostic fix for "a share page's og:image is actually the app's
// generic banner/logo, reused identically on every share link," which is
// the exact failure Collect exhibits. If a candidate image is byte-for-byte
// the same URL as what the SITE ROOT also declares as its image, that's a
// strong, provider-agnostic signal it's generic chrome, not this specific
// shared asset -- reject it rather than risk showing the wrong picture.
// Best-effort: any failure here just means the comparison is skipped (never
// blocks the real image on an unrelated root-page fetch failure).
async function isLikelyGenericSiteImage(candidateImageUrl: string, pageUrl: string): Promise<boolean> {
  try {
    const origin = new URL(pageUrl).origin;
    if (candidateImageUrl === `${origin}/` || new URL(pageUrl).pathname === "/") return false;
    const rootResult = await safeFetch(origin);
    if (!rootResult.ok) return false;
    const rootContentType = rootResult.response.headers.get("content-type") ?? "";
    if (!rootContentType.startsWith("text/html")) return false;
    const rootHtml = await rootResult.response.text();
    const rootImage = extractDeclaredImageUrl(rootHtml, origin);
    return rootImage !== null && rootImage === candidateImageUrl;
  } catch {
    return false;
  }
}

export type ResolvedExternalMedia =
  | { kind: "image"; buffer: Buffer; contentType: string; fileName: string; label: string | null }
  | { kind: "video"; buffer: Buffer; contentType: string; fileName: string; label: string | null }
  | { kind: "link"; url: string }
  | { kind: "error"; message: string };

function fileNameFromUrl(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").pop()?.split("?")[0] || "file");
  } catch {
    return "file";
  }
}

// The one entry point: safely resolve a user-pasted URL to real image/video
// bytes, or admit it's just a link. Every step that reaches out to the
// network goes through safeFetch, so SSRF protection applies uniformly to
// the initial URL, a provider-normalized direct-asset URL, a scraped
// og:image/og:video URL, and the root-page comparison fetch alike.
export async function resolveExternalMedia(rawUrl: string): Promise<ResolvedExternalMedia> {
  // TEMPORARY DIAGNOSTIC LOGGING -- remove before merge. Traces every
  // decision point per the requested debug protocol.
  const trace = (point: string, data: Record<string, unknown>) =>
    console.log(`[BRIEF_LINK_TRACE] ${point}`, JSON.stringify(data));
  trace("start", { rawUrl });

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    trace("invalid_url", {});
    return { kind: "error", message: "That doesn't look like a valid URL." };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    trace("unsupported_protocol", { protocol: parsed.protocol });
    return { kind: "error", message: "Only http/https URLs are supported." };
  }

  const normalized = normalizeProviderUrl(parsed);
  trace("normalized_url", { normalized: normalized.toString() });
  const first = await safeFetch(normalized.toString());
  if (!first.ok) {
    trace("safeFetch_failed", { reason: first.error.reason, host: "host" in first.error ? first.error.host : undefined });
    if (first.error.reason === "blocked_host") {
      return { kind: "error", message: "This link isn't allowed." };
    }
    return { kind: "link", url: rawUrl };
  }
  trace("safeFetch_ok", {
    status: first.response.status,
    finalUrl: first.finalUrl,
    contentType: first.response.headers.get("content-type"),
    contentLength: first.response.headers.get("content-length"),
  });
  if (!first.response.ok) {
    trace("response_not_ok", { status: first.response.status });
    // A provider-normalized URL that 403/404s (e.g. Drive's uc?download for
    // a restricted file, or a dead Dropbox link) means "not accessible,"
    // not "this URL is broken" -- the ORIGINAL url is still a perfectly
    // valid thing to keep as a link, so fall back rather than error out.
    return { kind: "link", url: rawUrl };
  }

  const contentType = cleanMimeType(first.response.headers.get("content-type") ?? "");
  const contentLengthHeader = first.response.headers.get("content-length");
  trace("content_type_resolved", { rawHeader: first.response.headers.get("content-type"), cleaned: contentType });
  if (contentLengthHeader && Number(contentLengthHeader) > MAX_FETCH_BYTES) {
    trace("content_length_exceeded", { contentLengthHeader, MAX_FETCH_BYTES });
    return { kind: "link", url: rawUrl };
  }

  if (contentType.startsWith("image/") || contentType.startsWith("video/")) {
    const buffer = await readBodyWithLimit(first.response, MAX_FETCH_BYTES);
    trace("direct_media_branch", { contentType, bufferBytes: buffer?.length ?? null });
    if (!buffer) return { kind: "link", url: rawUrl };
    const kind = contentType.startsWith("video/") ? "video" : "image";
    trace("direct_media_success", { kind });
    return { kind, buffer, contentType, fileName: fileNameFromUrl(first.finalUrl), label: null };
  }

  if (!contentType.startsWith("text/html")) {
    trace("not_html_not_media_fallback_link", { contentType });
    // Some other content type (application/octet-stream, pdf, etc.) --
    // not something this pass classifies as image/video, keep as a link
    // rather than guessing.
    return { kind: "link", url: rawUrl };
  }
  trace("html_branch_entered", {});

  // An HTML share/preview page -- look for the page's OWN declared media,
  // never a generic first <img> guess.
  const html = await first.response.text();
  const scrapedTitle = extractPageTitle(html);
  trace("html_scraped", { htmlLength: html.length, scrapedTitle });

  const declaredVideoUrl = extractDeclaredVideoUrl(html, first.finalUrl);
  trace("declared_video_url", { declaredVideoUrl });
  if (declaredVideoUrl) {
    const videoResult = await safeFetch(declaredVideoUrl);
    if (videoResult.ok && videoResult.response.ok) {
      const videoType = cleanMimeType(videoResult.response.headers.get("content-type") ?? "");
      trace("declared_video_fetched", { status: videoResult.response.status, videoType });
      if (videoType.startsWith("video/")) {
        const buffer = await readBodyWithLimit(videoResult.response, MAX_FETCH_BYTES);
        if (buffer) {
          trace("declared_video_success", {});
          return {
            kind: "video",
            buffer,
            contentType: videoType,
            fileName: fileNameFromUrl(videoResult.finalUrl),
            label: scrapedTitle,
          };
        }
      }
    } else {
      trace("declared_video_fetch_failed", { ok: videoResult.ok });
    }
  }

  const declaredImageUrl = extractDeclaredImageUrl(html, first.finalUrl);
  trace("declared_image_url", { declaredImageUrl });
  if (declaredImageUrl) {
    const isGeneric = await isLikelyGenericSiteImage(declaredImageUrl, first.finalUrl);
    trace("is_likely_generic_site_image", { isGeneric });
    if (!isGeneric) {
      const imageResult = await safeFetch(declaredImageUrl);
      if (imageResult.ok && imageResult.response.ok) {
        const imageType = cleanMimeType(imageResult.response.headers.get("content-type") ?? "");
        trace("declared_image_fetched", { status: imageResult.response.status, imageType });
        if (imageType.startsWith("image/")) {
          const buffer = await readBodyWithLimit(imageResult.response, MAX_FETCH_BYTES);
          if (buffer) {
            trace("declared_image_success", {});
            return {
              kind: "image",
              buffer,
              contentType: imageType,
              fileName: fileNameFromUrl(imageResult.finalUrl),
              label: scrapedTitle,
            };
          }
        }
      } else {
        trace("declared_image_fetch_failed", { ok: imageResult.ok });
      }
    }
  }
  trace("final_fallback_link", {});

  return { kind: "link", url: rawUrl };
}
