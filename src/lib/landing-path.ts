import type { createClient } from "@/lib/supabase/server";
import { mergeWorkspaceSettings } from "@/lib/account-settings";
import { getUserProjectLists } from "@/lib/project-lists";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// Shared by the post-login redirect (lib/actions/auth.ts) AND the app
// header's logo link (see app-header.tsx's homeHref prop) -- both need "where
// does this user's Default Home Page setting actually point," so it lives
// here once rather than drifting into two separate implementations. (Lives
// outside account-settings.ts because that file is also imported by client
// components, and this needs the server-only project-lists loader.)
//
// "projects" and "todo" are real, unambiguous global routes. The other
// three (calendar/grid/overview) are per-project pages -- there's no single
// right answer for a user in multiple projects, so this picks the first
// ACTIVE project in the same order the Projects page and nav switcher use
// (never an archived one). Falls back to /projects for a user with no active
// project, or if their projects couldn't be loaded.
export async function resolveLandingPath(supabase: SupabaseServerClient, userId: string): Promise<string> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("workspace_settings")
    .eq("id", userId)
    .single();
  const { default_landing_page: page } = mergeWorkspaceSettings(profile?.workspace_settings);

  if (page === "projects") return "/projects";
  if (page === "todo") return "/tasks";

  const lists = await getUserProjectLists(userId);
  const first = lists.ok ? lists.active[0] : undefined;
  if (!first) return "/projects";

  const subPath = page === "grid" ? "grid" : page === "calendar" ? "calendar" : "";
  return `/projects/${first.id}${subPath ? `/${subPath}` : ""}`;
}
