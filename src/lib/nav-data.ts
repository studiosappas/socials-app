import type { createClient } from "@/lib/supabase/server";
import { getCachedSignedUrls } from "@/lib/signed-url-cache";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type NavProject = { id: string; name: string; avatarUrl: string | null };

// Shared by AppHeader's project-switcher dropdown AND its current-project
// avatar/hover-menu -- one fetch covers both, since "current project" is
// just whichever item in this same list matches the URL's projectId. This
// runs on literally every navigation across the whole app (it's called from
// every top-level layout.tsx), so it was the single most-repeated signed-URL
// mint in the app -- re-signing every project's avatar on every click even
// though the app-header data itself never actually flashes/reloads.
// getCachedSignedUrls also means the SAME cache entry (keyed by storage
// path, not by which page asked) is shared with Grid/Overview/Tasks, which
// each independently sign this exact same profile_photo_path.
export async function getUserProjectsForNav(
  supabase: SupabaseServerClient,
  userId: string,
): Promise<NavProject[]> {
  const { data: memberships } = await supabase
    .from("project_members")
    .select("projects(id, name, profile_photo_path, created_at)")
    .eq("user_id", userId);

  const projects = (memberships ?? [])
    .map((m) => m.projects)
    .filter((p): p is NonNullable<typeof p> => Boolean(p?.id))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  const paths = projects.map((p) => p.profile_photo_path).filter((p): p is string => Boolean(p));
  const urlByPath = await getCachedSignedUrls(supabase, "project-media", paths);

  return projects.map((p) => ({
    id: p.id,
    name: p.name,
    avatarUrl: p.profile_photo_path ? urlByPath.get(p.profile_photo_path) ?? null : null,
  }));
}

// Shared by AppHeader's user-identity item (the icon + first-name link that
// replaced the plain "Account" label) -- same profiles.name field the
// Account page's own Profile card reads/edits (see account/page.tsx,
// account-panel.tsx), so a name saved there is the exact same value this
// resolves, no second source of truth. profiles.name is a free-text full
// name field (there's no separate first/last split anywhere in the schema),
// so "first name" here just means its first whitespace-separated token --
// good enough for a compact nav label without inventing real name-parsing.
// Returns null (not "") on anything unusable so the caller can fall back to
// the plain "Account" label instead of rendering broken/empty text.
export async function getUserDisplayFirstName(supabase: SupabaseServerClient, userId: string): Promise<string | null> {
  const { data } = await supabase.from("profiles").select("name").eq("id", userId).single();
  const firstName = data?.name?.trim().split(/\s+/)[0];
  return firstName || null;
}
