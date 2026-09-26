import { unstable_cache } from "next/cache";
import type { createClient } from "@/lib/supabase/server";

// Every page that shows media (Grid, Calendar, Post Editor, Stories, Brief's
// moodboard) used to call createSignedUrl(s) fresh on every single render --
// including a render triggered by an unrelated mutation elsewhere on the
// same route (e.g. editing a caption re-signs every asset thumbnail on the
// page). A signed URL's token changes every time it's re-minted even though
// the underlying file didn't, so the browser can never reuse its own
// decoded image for the new URL string -- that's what "media flashes/
// reloads after an unrelated action" actually was. Caching the URL itself
// (not just the DB query that finds the path) means the same request for
// the same storage path returns the identical URL for the rest of the
// current cache window, so an unrelated mutation's re-render reuses exactly
// the same <img src>, and the browser serves it from its own cache with no
// network request at all.
export const SIGNED_URL_TTL_SECONDS = 3600;
// How long one minted URL may be handed out. Half the token's own lifetime,
// so every URL this module returns still has AT LEAST
// (TTL - CACHE_WINDOW_SECONDS) = 30 minutes of validity left at the moment
// it's handed to the browser.
const CACHE_WINDOW_SECONDS = 1800;
// Hard ceiling enforced on READ, independent of whatever the cache layer
// itself decides is "fresh" -- see getCachedSignedUrl's own comment for the
// real bug this guards against. A minute of slack for clock skew between
// the instance that minted an entry and the one reading it.
const MAX_SERVED_AGE_MS = (CACHE_WINDOW_SECONDS + 60) * 1000;

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

type CachedSignedUrl = { url: string; mintedAt: number };

// ---------------------------------------------------------------------------
// Batched signing.
//
// A cold Grid render used to fire ONE createSignedUrl HTTP request per path,
// all at once via Promise.all -- a project with a few hundred library assets
// meant a few hundred simultaneous Storage API requests from a single page
// render, every time a cache window rolled over. Any one of them failing
// (rate limiting, a dropped connection, a timeout under that burst) became a
// null URL for that one tile -- and because failures are deliberately never
// cached (see below), the refresh that followed only had to re-sign the
// handful that failed, which then succeeded: "refresh fixes it" again.
//
// Instead, every cache MISS in the same short window is collected per
// (client, bucket) and sent as one storage.createSignedUrls call per
// SIGN_BATCH_MAX paths. Cache hits never reach this at all.
// ---------------------------------------------------------------------------
const SIGN_BATCH_MAX = 100;
// Long enough for cache lookups that were kicked off together (one
// Promise.all over every path on a page) to land in the same batch, short
// enough to be invisible next to the Storage round trip itself.
const SIGN_BATCH_WINDOW_MS = 5;
// Retries only a WHOLE-REQUEST failure (network error, 5xx, rate limit) --
// never a per-path error like "Object not found", which is deterministic and
// retrying would only hide a real data problem. Bounded: 3 attempts total.
const SIGN_RETRY_DELAYS_MS = [250, 750];

type SignWaiter = { resolve: (url: string) => void; reject: (err: Error) => void };
type SignQueue = { waiters: Map<string, SignWaiter[]>; timer: ReturnType<typeof setTimeout> | null };

// Keyed by the Supabase client instance itself, so a batch only ever signs
// with the one client (and therefore the one user's auth/RLS context) that
// asked for those paths -- never pooled across users.
const signQueues = new WeakMap<SupabaseServerClient, Map<string, SignQueue>>();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function signBatchWithRetry(
  supabase: SupabaseServerClient,
  bucket: string,
  paths: string[],
): Promise<Map<string, string | Error>> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= SIGN_RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) await sleep(SIGN_RETRY_DELAYS_MS[attempt - 1]);
    try {
      const { data, error } = await supabase.storage.from(bucket).createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
      if (error || !data) {
        lastError = new Error(`Batch sign failed (${bucket}, ${paths.length} paths): ${error?.message ?? "no data returned"}`);
        continue;
      }
      const result = new Map<string, string | Error>();
      for (const entry of data) {
        if (!entry.path) continue;
        result.set(
          entry.path,
          entry.signedUrl && !entry.error ? entry.signedUrl : new Error(`Failed to sign ${bucket}/${entry.path}: ${entry.error ?? "no signed URL returned"}`),
        );
      }
      return result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }
  // Only the storage path and bucket, never a URL or token.
  console.warn(`[signed-url-cache] ${lastError?.message ?? "batch sign failed"} after ${SIGN_RETRY_DELAYS_MS.length + 1} attempts`);
  const failed = new Map<string, string | Error>();
  for (const path of paths) failed.set(path, lastError ?? new Error("Batch sign failed"));
  return failed;
}

async function flushSignQueue(supabase: SupabaseServerClient, bucket: string, queue: SignQueue) {
  const waiters = queue.waiters;
  queue.waiters = new Map();
  queue.timer = null;
  const paths = Array.from(waiters.keys());
  const chunks: string[][] = [];
  for (let i = 0; i < paths.length; i += SIGN_BATCH_MAX) chunks.push(paths.slice(i, i + SIGN_BATCH_MAX));

  await Promise.all(
    chunks.map(async (chunk) => {
      const results = await signBatchWithRetry(supabase, bucket, chunk);
      for (const path of chunk) {
        const result = results.get(path) ?? new Error(`Failed to sign ${bucket}/${path}: missing from batch response`);
        for (const waiter of waiters.get(path) ?? []) {
          if (typeof result === "string") waiter.resolve(result);
          else waiter.reject(result);
        }
      }
    }),
  );
}

function requestSign(supabase: SupabaseServerClient, bucket: string, path: string): Promise<string> {
  let byBucket = signQueues.get(supabase);
  if (!byBucket) {
    byBucket = new Map();
    signQueues.set(supabase, byBucket);
  }
  let queue = byBucket.get(bucket);
  if (!queue) {
    queue = { waiters: new Map(), timer: null };
    byBucket.set(bucket, queue);
  }
  const q = queue;
  return new Promise<string>((resolve, reject) => {
    const list = q.waiters.get(path);
    if (list) list.push({ resolve, reject });
    else q.waiters.set(path, [{ resolve, reject }]);
    if (q.waiters.size >= SIGN_BATCH_MAX) {
      if (q.timer) clearTimeout(q.timer);
      void flushSignQueue(supabase, bucket, q);
    } else if (!q.timer) {
      q.timer = setTimeout(() => void flushSignQueue(supabase, bucket, q), SIGN_BATCH_WINDOW_MS);
    }
  });
}

// THROWS on failure -- never returns null for a failed sign. This matters
// specifically because of how getCachedSignedUrl below wraps this in
// unstable_cache: Next only ever persists a cache entry for a call that
// RESOLVES (confirmed against unstable_cache's own source -- the "generate
// a new entry" path awaits the callback and only calls cacheNewResult()
// on the value it resolved with; a rejection propagates straight out with
// nothing written to the cache). A version of this that swallowed the
// Storage error and returned `null` on failure was silently caching that
// null for the whole cache window -- indistinguishable from a real "no URL
// for this path" result, and shared by EVERY user who requested the same
// (bucket, path) in that window, not just whoever hit the original failure.
async function signOne(supabase: SupabaseServerClient, bucket: string, path: string): Promise<CachedSignedUrl> {
  const url = await requestSign(supabase, bucket, path);
  return { url, mintedAt: Date.now() };
}

// Cached per (bucket, path, window) -- safe to share across requests/users:
// a storage path is already project-scoped by its own prefix, and anyone who
// can reach this function already passed whatever RLS-gated DB query found
// the path in the first place, same as an uncached signed URL would've
// required anyway.
//
// ROOT CAUSE this shape fixes ("Grid images missing on first entry, a
// refresh makes them appear"): the previous version cached each URL under
// a fixed key with `revalidate: 1800`. unstable_cache is STALE-WHILE-
// REVALIDATE during a normal request render -- confirmed in Next 16.2's
// own unstable-cache.js: a stale entry is returned immediately ("we're
// doing background revalidation - return stale immediately") and only
// refreshed in the background for the NEXT request. Nothing ever evicts an
// entry by age. So opening a project whose media was last signed more
// than an hour ago handed the browser URLs whose 1-hour token had ALREADY
// EXPIRED (Storage answers 400) -- every one of those tiles stayed blank,
// while the background revalidation quietly stored fresh URLs, which is
// exactly why a refresh "fixed" it. Between 30 and 60 minutes the same
// path served URLs with only minutes left, which then failed later, e.g.
// when a lazy-loaded tile finally scrolled into view.
//
// Fixed two ways, either sufficient on its own:
// 1. The cache key includes the current CACHE_WINDOW_SECONDS window, so a
//    new window is always a genuine MISS (freshly signed), never a stale
//    hit -- an entry is only ever read inside the window it was minted in.
// 2. The minted-at timestamp is stored with the URL and checked on every
//    read; anything older than MAX_SERVED_AGE_MS is never returned, no
//    matter what the cache layer considers fresh.
export async function getCachedSignedUrl(
  supabase: SupabaseServerClient,
  bucket: string,
  path: string | null | undefined,
): Promise<string | null> {
  if (!path) return null;
  const windowIndex = Math.floor(Date.now() / (CACHE_WINDOW_SECONDS * 1000));
  const cached = unstable_cache(() => signOne(supabase, bucket, path), ["signed-url-v2", bucket, path, String(windowIndex)], {
    revalidate: CACHE_WINDOW_SECONDS,
  });
  try {
    const entry = await cached();
    if (entry && typeof entry.url === "string" && typeof entry.mintedAt === "number" && Date.now() - entry.mintedAt <= MAX_SERVED_AGE_MS) {
      return entry.url;
    }
    // Too old (or an unexpected shape) -- sign directly for this request
    // instead of handing out a URL that may already be dead. Not written
    // back to the cache; the next window's key is a clean miss anyway.
    return await requestSign(supabase, bucket, path);
  } catch {
    // Caught here, OUTSIDE the unstable_cache-wrapped function -- so this
    // null is this one request's own return value, never itself written
    // to the cache. The next request for this exact path (this user's own
    // retry, or another member opening the same asset moments later) gets
    // a completely fresh sign attempt instead of replaying this failure.
    return null;
  }
}

// Batch helper matching the shape callers already use around
// storage.createSignedUrls -- still one cached entry per path (so a path
// already signed for one page is reused by another), with every cache miss
// among them coalesced into batched createSignedUrls calls (see requestSign).
export async function getCachedSignedUrls(
  supabase: SupabaseServerClient,
  bucket: string,
  paths: string[],
): Promise<Map<string, string>> {
  const unique = Array.from(new Set(paths.filter(Boolean)));
  const entries = await Promise.all(
    unique.map(async (path) => [path, await getCachedSignedUrl(supabase, bucket, path)] as const),
  );
  const map = new Map<string, string>();
  for (const [path, url] of entries) {
    if (url) map.set(path, url);
  }
  return map;
}
