import { safeFetch } from "@/lib/safe-fetch";

// UNDOCUMENTED DEPENDENCY -- the one fallback request approved 2026-10-02
// ("Option 2"). Pinterest's own logged-out web app reads a Pin's data from
// this internal JSON endpoint. It is NOT a public API: Pinterest can change
// it, rate-limit it, or block server/datacenter traffic to it at any time.
// Every failure mode therefore returns null, which the Brief import turns into
// a clear "couldn't be loaded" error -- never a guess, never a thumbnail.
//
// Called ONLY by resolvePinterestPin (lib/pinterest-media.ts), and only for a
// multi-item Pin whose page didn't say what each item is. Isolated here so it
// can be replaced or switched off without touching the Brief import flow:
// set PINTEREST_PIN_RESOURCE_FALLBACK=off to disable it (carousels whose page
// lacks per-item data then fail safely with that same error).
//
// No login, cookies or credentials are sent. The only non-default header is
// X-Pinterest-PWS-Handler, a static routing hint the endpoint requires
// (without it: HTTP 403). Nothing from the response is persisted -- it is
// parsed for the requested Pin's media and dropped.

const TIMEOUT_MS = 8000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export function isPinResourceFallbackEnabled(): boolean {
  return process.env.PINTEREST_PIN_RESOURCE_FALLBACK !== "off";
}

export function pinResourceUrl(pinId: string): string {
  const data = JSON.stringify({ options: { id: pinId, field_set_key: "unauth_react_main_pin" }, context: {} });
  return `https://www.pinterest.com/resource/PinResource/get/?source_url=${encodeURIComponent(`/pin/${pinId}/`)}&data=${encodeURIComponent(data)}`;
}

async function readTextWithLimit(response: Response, maxBytes: number): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;
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
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
}

// Raw JSON for exactly `pinId`, or null. The caller (pinMediaFromPinResource)
// still verifies the response's own Pin id before using anything from it.
export async function fetchPinterestPinResource(pinId: string): Promise<unknown | null> {
  if (!isPinResourceFallbackEnabled() || !/^\d{6,25}$/.test(pinId)) return null;
  try {
    const result = await safeFetch(pinResourceUrl(pinId), {
      headers: { accept: "application/json", "x-pinterest-pws-handler": "www/pin/[id].js" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!result.ok || !result.response.ok) return null;
    const contentLength = result.response.headers.get("content-length");
    if (contentLength && Number(contentLength) > MAX_RESPONSE_BYTES) return null;
    const text = await readTextWithLimit(result.response, MAX_RESPONSE_BYTES);
    return text === null ? null : (JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}
