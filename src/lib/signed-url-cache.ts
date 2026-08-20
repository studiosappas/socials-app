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
// the same storage path returns the identical URL for CACHE_REVALIDATE_
// SECONDS, so an unrelated mutation's re-render reuses exactly the same
// <img src>, and the browser serves it from its own cache with no network
// request at all.
export const SIGNED_URL_TTL_SECONDS = 3600;
// Comfortably under the token's own 1-hour lifetime, so nothing is ever
// handed a URL that's about to stop working mid-page-life, while still long
// enough that back-to-back interactions on the same page reuse it.
const CACHE_REVALIDATE_SECONDS = 1800;

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

async function signOne(supabase: SupabaseServerClient, bucket: string, path: string): Promise<string | null> {
  const { data } = await supabase.storage.from(bucket).createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  return data?.signedUrl ?? null;
}

// Cached per (bucket, path) -- safe to share across requests/users: a
// storage path is already project-scoped by its own prefix, and anyone who
// can reach this function already passed whatever RLS-gated DB query found
// the path in the first place, same as an uncached signed URL would've
// required anyway.
export async function getCachedSignedUrl(
  supabase: SupabaseServerClient,
  bucket: string,
  path: string | null | undefined,
): Promise<string | null> {
  if (!path) return null;
  const cached = unstable_cache(() => signOne(supabase, bucket, path), ["signed-url", bucket, path], {
    revalidate: CACHE_REVALIDATE_SECONDS,
  });
  return cached();
}

// Batch helper matching the shape callers already use around
// storage.createSignedUrls -- internally still one cached entry per path
// (so a path already signed for one page is reused by another), just fanned
// out in parallel rather than sent as a single multi-path request.
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
