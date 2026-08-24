import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// SSRF protection for any server-side fetch of a user-supplied URL. Nothing
// like this existed anywhere in the app before -- addBriefTaskLink (the one
// place that fetches an arbitrary external URL) previously called raw
// `fetch()` with zero host/IP validation, on both the initial URL and any
// og:image it scraped from the page. This is the shared, reusable fix for
// that whole class of gap, not a Brief-specific patch -- anything that needs
// to fetch a URL a user pasted should go through safeFetch below instead of
// calling fetch() directly.
//
// The core rule: a URL is safe to fetch only if EVERY IP address it (or any
// redirect it points to) resolves to is a normal public address. Blocking
// is IP-range-based, not hostname-based -- checking hostnames like
// "localhost" would miss "http://127.0.0.1", a bare IP literal
// ("http://169.254.169.254/..."), or a public-looking hostname that
// actually resolves to a private/internal address (DNS rebinding).

const BLOCKED_IPV4_RANGES: [string, number][] = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, includes 169.254.169.254 cloud metadata
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved
];

function ipv4ToInt(ip: string): number {
  const parts = ip.split(".").map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isBlockedIpv4(ip: string): boolean {
  const target = ipv4ToInt(ip);
  return BLOCKED_IPV4_RANGES.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (target & mask) === (ipv4ToInt(base) & mask);
  });
}

// IPv6: loopback (::1), unique-local (fc00::/7), link-local (fe80::/10,
// includes the IPv6 cloud-metadata equivalent some providers use), and an
// IPv4-mapped address (::ffff:a.b.c.d) is unwrapped and checked as IPv4 --
// otherwise an attacker could smuggle a blocked IPv4 target through its
// IPv6-mapped form.
function isBlockedIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "::1" || normalized === "::") return true;
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIpv4(mapped[1]);
  const firstGroup = normalized.split(":")[0];
  if (firstGroup.length === 4 || firstGroup.length === 2) {
    const value = parseInt(firstGroup.padStart(4, "0"), 16);
    if ((value & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
    if ((value & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  }
  return false;
}

function isBlockedIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isBlockedIpv4(ip);
  if (version === 6) return isBlockedIpv6(ip);
  return true; // not a recognizable IP at all -- fail closed
}

// Resolves a hostname to every address it could actually connect to and
// rejects if ANY of them is blocked -- a hostname that resolves to both a
// public and a private IP (round-robin/rebinding) must not be treated as
// safe just because one answer looked fine.
async function isHostSafe(hostname: string): Promise<boolean> {
  const literalVersion = isIP(hostname);
  if (literalVersion) return !isBlockedIp(hostname);
  if (hostname.toLowerCase() === "localhost") return false;
  try {
    const records = await lookup(hostname, { all: true, verbatim: true });
    if (records.length === 0) return false;
    return records.every((r) => !isBlockedIp(r.address));
  } catch {
    return false; // couldn't resolve -- fail closed, never fetch blind
  }
}

export type SafeFetchError =
  | { reason: "invalid_url" }
  | { reason: "unsupported_protocol" }
  | { reason: "blocked_host"; host: string }
  | { reason: "too_many_redirects" }
  | { reason: "network_error" };

export type SafeFetchResult = { ok: true; response: Response; finalUrl: string } | { ok: false; error: SafeFetchError };

const MAX_REDIRECTS = 5;

// Fetches with SSRF protection applied to the initial URL AND to every
// redirect hop -- `redirect: "manual"` so a 3xx response is inspected and
// re-validated ourselves instead of letting the runtime follow it straight
// to wherever it points (a public URL that 302s to an internal address is
// exactly the bypass a naive "just check the URL the user typed" guard
// misses).
export async function safeFetch(url: string, init?: RequestInit): Promise<SafeFetchResult> {
  let currentUrl = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let parsed: URL;
    try {
      parsed = new URL(currentUrl);
    } catch {
      return { ok: false, error: { reason: "invalid_url" } };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { ok: false, error: { reason: "unsupported_protocol" } };
    }
    if (!(await isHostSafe(parsed.hostname))) {
      return { ok: false, error: { reason: "blocked_host", host: parsed.hostname } };
    }

    let response: Response;
    try {
      response = await fetch(currentUrl, { ...init, redirect: "manual" });
    } catch {
      return { ok: false, error: { reason: "network_error" } };
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return { ok: false, error: { reason: "network_error" } };
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    return { ok: true, response, finalUrl: currentUrl };
  }
  return { ok: false, error: { reason: "too_many_redirects" } };
}
