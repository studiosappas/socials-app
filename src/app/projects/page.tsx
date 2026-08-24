import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCachedSignedUrls } from "@/lib/signed-url-cache";
import { Avatar } from "@/components/ui/avatar";
import { CreateProjectButton } from "./create-project-button";

export default async function ProjectsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Independent of each other -- neither needs the other's result.
  const [{ data: memberships }, { data: profile }] = await Promise.all([
    supabase
      .from("project_members")
      .select("role, projects(id, name, profile_photo_path, created_at)")
      .eq("user_id", user!.id),
    supabase.from("profiles").select("name, email, avatar_url").eq("id", user!.id).single(),
  ]);

  const projectIds = (memberships ?? [])
    .map((m) => m.projects?.id)
    .filter((id): id is string => Boolean(id));

  // Both isolated from the join above and from each other -- `archived` and
  // `last_visited_at` are newer columns that may not exist yet on a
  // not-yet-migrated database, and PostgREST fails the WHOLE embedded
  // select (every project, not just the one flag) if any requested column
  // -- even on a different table -- is missing. That's what made a pending
  // migration look like "all my projects are gone" once before (see this
  // file's git history): the entire list query was failing silently and
  // returning nothing. Isolating each one here means a pending migration
  // only means archived projects aren't filtered out yet, or recency
  // ordering falls back to created-date, never that the whole list
  // disappears.
  const [{ data: archivedRows }, { data: visitRows }] = await Promise.all([
    projectIds.length
      ? supabase.from("projects").select("id, archived").in("id", projectIds)
      : Promise.resolve({ data: [] }),
    supabase.from("project_members").select("project_id, last_visited_at").eq("user_id", user!.id),
  ]);
  const archivedById = new Map((archivedRows ?? []).map((r) => [r.id, r.archived]));
  const lastVisitedById = new Map(
    (visitRows ?? []).map((r) => [r.project_id, r.last_visited_at as string | null]),
  );

  // Same batch/cached signed-URL helper the top nav's project switcher
  // already uses for this exact column (see nav-data.ts's
  // getUserProjectsForNav) -- one cache entry per storage path, shared
  // across pages, no per-row signing.
  const avatarPaths = (memberships ?? [])
    .map((m) => m.projects?.profile_photo_path)
    .filter((p): p is string => Boolean(p));
  const urlByPath = await getCachedSignedUrls(supabase, "project-media", avatarPaths);

  const projects = (memberships ?? [])
    .map((m) => ({ ...m.projects, role: m.role }))
    .filter((p): p is NonNullable<typeof p> => Boolean(p?.id))
    .filter((p) => !archivedById.get(p.id))
    // Stable sort: newest-created first as the base/fallback order (matches
    // the nav switcher's own ordering for a project this user has never
    // visited), then most-recently-visited-by-this-user first on top of
    // that. Array.prototype.sort is guaranteed stable, so ties (both never
    // visited) keep the created-date order from the first pass.
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .sort((a, b) => {
      const av = lastVisitedById.get(a.id);
      const bv = lastVisitedById.get(b.id);
      if (!av && !bv) return 0;
      if (!av) return 1;
      if (!bv) return -1;
      return av < bv ? 1 : -1;
    });

  const currentUser = {
    name: profile?.name ?? user?.email ?? "You",
    email: profile?.email ?? user?.email ?? "",
    avatarUrl: profile?.avatar_url ?? null,
  };

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 px-8 py-16">
      <div className="flex flex-col gap-1">
        <p className="text-xs tracking-wide text-muted uppercase">Clients</p>
        <h1 className="text-2xl font-light">Projects</h1>
      </div>

      <CreateProjectButton currentUser={currentUser} />

      <ul className="flex flex-col">
        {projects.map((project) => (
          <li key={project.id} className="border-b border-border">
            <Link
              href={`/projects/${project.id}/grid`}
              className="flex items-center gap-3 px-1 py-4 transition-[transform,background-color] duration-100 hover:bg-black/[0.02] active:scale-[0.98] active:bg-black/[0.04]"
            >
              <Avatar
                name={project.name}
                avatarUrl={project.profile_photo_path ? (urlByPath.get(project.profile_photo_path) ?? null) : null}
                size="md"
              />
              <span className="min-w-0 flex-1 truncate text-sm tracking-wide uppercase">{project.name}</span>
              <span className="shrink-0 text-xs tracking-wide text-muted uppercase">{project.role}</span>
            </Link>
          </li>
        ))}
        {projects.length === 0 && (
          <p className="py-4 text-sm text-muted">No projects yet — create one above.</p>
        )}
      </ul>
    </main>
  );
}
