import type { Platform } from "@/types/database";

// A project has exactly one platform selected at a time and one shared
// handle field (ig_username) reused for whichever is active. For
// instagram/tiktok specifically, an explicit saved profile URL
// (projects.instagram_url/tiktok_url) always wins when present -- it's what
// "connects" the username to a real, possibly custom, profile link; the
// handle-derived URL below is only the fallback for projects that haven't
// filled those in yet.
export function socialProfileUrl(
  platform: Platform,
  username: string,
  savedUrls?: { instagramUrl?: string | null; tiktokUrl?: string | null },
): string | null {
  if (platform === "instagram" && savedUrls?.instagramUrl) {
    const url = externalUrl(savedUrls.instagramUrl);
    if (url) return url;
  }
  if (platform === "tiktok" && savedUrls?.tiktokUrl) {
    const url = externalUrl(savedUrls.tiktokUrl);
    if (url) return url;
  }

  const handle = username.trim().replace(/^@+/, "");
  if (!handle) return null;
  switch (platform) {
    case "tiktok":
      return `https://www.tiktok.com/@${handle}`;
    case "pinterest":
      return `https://pinterest.com/${handle}`;
    case "youtube":
      return `https://www.youtube.com/@${handle}`;
    case "instagram":
    default:
      return `https://instagram.com/${handle}`;
  }
}

// The website field is free text (e.g. "example.com", no protocol) --
// browsers treat a protocol-less href as a relative link on the current
// site, so a missing "https://" would silently turn "Click here" into a
// broken same-site navigation instead of leaving the page.
export function externalUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}
