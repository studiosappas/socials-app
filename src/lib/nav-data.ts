import type { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

const SIGNED_URL_TTL_SECONDS = 3600;

export type NavProject = { id: string; name: string; avatarUrl: string | null };

// Shared by AppHeader's project-switcher dropdown AND its current-project
// avatar/hover-menu -- one fetch covers both, since "current project" is
// just whichever item in this same list matches the URL's projectId.
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
  const { data: signedUrls } = paths.length
    ? await supabase.storage.from("project-media").createSignedUrls(paths, SIGNED_URL_TTL_SECONDS)
    : { data: [] };

  const urlByPath = new Map<string, string>();
  for (const entry of signedUrls ?? []) {
    if (entry.signedUrl && entry.path) urlByPath.set(entry.path, entry.signedUrl);
  }

  return projects.map((p) => ({
    id: p.id,
    name: p.name,
    avatarUrl: p.profile_photo_path ? urlByPath.get(p.profile_photo_path) ?? null : null,
  }));
}
