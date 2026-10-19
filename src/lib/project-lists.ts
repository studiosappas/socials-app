import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import {
  selectActiveProjects,
  selectArchivedManageableProjects,
  type ProjectListEntry,
} from "@/lib/project-list-filter";
import type { ProjectRole } from "@/types/database";

export type { ProjectListEntry } from "@/lib/project-list-filter";

export type UserProjectLists =
  | { ok: true; active: ProjectListEntry[]; archived: ProjectListEntry[] }
  | { ok: false; error: string };

// The single source for "this user's projects", split into active (Projects
// page, top-nav switcher, To-Do, default landing page) and archived
// (Account > Archived Projects, owner/admin only). Wrapped in React's
// cache() so the several callers in one render (a layout's nav + landing
// path + the page itself) share one set of reads.
//
// Three reads, deliberately separate:
// - memberships + project basics: the list itself.
// - `archived`: REQUIRED. If it fails, the whole result fails ({ ok: false })
//   -- callers show an error/empty state, never an unfiltered list that
//   could surface archived projects.
// - `last_visited_at`: optional, ordering only. A failure there just falls
//   back to newest-created order.
export const getUserProjectLists = cache(async (userId: string): Promise<UserProjectLists> => {
  const supabase = await createClient();

  const { data: memberships, error: membershipsError } = await supabase
    .from("project_members")
    .select("role, custom_permissions, projects(id, name, profile_photo_path, created_at)")
    .eq("user_id", userId);
  if (membershipsError) {
    console.error("[project-lists] memberships read failed", membershipsError.message);
    return { ok: false, error: "We couldn't load your projects." };
  }

  const entries: ProjectListEntry[] = [];
  for (const m of memberships ?? []) {
    const p = m.projects;
    if (!p?.id) continue;
    entries.push({
      id: p.id,
      name: p.name,
      profilePhotoPath: p.profile_photo_path ?? null,
      createdAt: p.created_at,
      role: m.role as ProjectRole,
      customPermissions: m.custom_permissions ?? null,
    });
  }

  const ids = entries.map((e) => e.id);
  const [archivedResult, visitResult] = await Promise.all([
    ids.length
      ? supabase.from("projects").select("id, archived").in("id", ids)
      : Promise.resolve({ data: [] as { id: string; archived: boolean }[], error: null }),
    supabase.from("project_members").select("project_id, last_visited_at").eq("user_id", userId),
  ]);

  if (archivedResult.error) {
    console.error("[project-lists] archived-state read failed", archivedResult.error.message);
    return { ok: false, error: "We couldn't load your projects." };
  }

  const archivedById = new Map<string, boolean>();
  for (const r of archivedResult.data ?? []) {
    if (typeof r.archived === "boolean") archivedById.set(r.id, r.archived);
  }
  const lastVisitedById = new Map<string, string | null>(
    visitResult.error
      ? []
      : (visitResult.data ?? []).map((r) => [r.project_id, (r.last_visited_at as string | null) ?? null]),
  );

  return {
    ok: true,
    active: selectActiveProjects(entries, archivedById, lastVisitedById),
    archived: selectArchivedManageableProjects(entries, archivedById),
  };
});
