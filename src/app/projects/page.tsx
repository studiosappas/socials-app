import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createProject } from "@/lib/actions/projects";
import { Button } from "@/components/ui/button";

export default async function ProjectsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: memberships } = await supabase
    .from("project_members")
    .select("role, projects(id, name, created_at)")
    .eq("user_id", user!.id);

  const projectIds = (memberships ?? [])
    .map((m) => m.projects?.id)
    .filter((id): id is string => Boolean(id));

  // Isolated from the join above -- `archived` is a newer projects column
  // that may not exist yet on a not-yet-migrated database, and PostgREST
  // fails the WHOLE embedded select (every project, not just the archived
  // flag) if any requested column -- even on the joined table -- is
  // missing. That's what made a pending migration look like "all my
  // projects are gone": the entire list query was failing silently and
  // returning nothing. Isolating it here means a pending migration only
  // means archived projects aren't filtered out yet, never that the whole
  // list disappears.
  const { data: archivedRows } = projectIds.length
    ? await supabase.from("projects").select("id, archived").in("id", projectIds)
    : { data: [] };
  const archivedById = new Map((archivedRows ?? []).map((r) => [r.id, r.archived]));

  const projects = (memberships ?? [])
    .map((m) => ({ ...m.projects, role: m.role }))
    .filter((p): p is NonNullable<typeof p> => Boolean(p?.id))
    .filter((p) => !archivedById.get(p.id));

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 px-8 py-16">
      <div className="flex flex-col gap-1">
        <p className="text-xs tracking-wide text-muted uppercase">Clients</p>
        <h1 className="text-2xl font-light">Projects</h1>
      </div>

      <form action={createProject} className="flex items-end gap-4">
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-xs tracking-wide text-muted uppercase">
            New client / brand name
          </span>
          <input
            name="name"
            required
            className="border-0 border-b border-border bg-transparent py-1.5 text-sm focus:border-foreground focus:outline-none"
          />
        </label>
        <Button type="submit" variant="primary">
          Create
        </Button>
      </form>

      <ul className="flex flex-col">
        {projects.map((project) => (
          <li key={project.id} className="border-b border-border">
            <Link
              href={`/projects/${project.id}/grid`}
              className="flex items-center justify-between px-1 py-4 transition-[transform,background-color] duration-100 hover:bg-black/[0.02] active:scale-[0.98] active:bg-black/[0.04]"
            >
              <span className="text-sm">{project.name}</span>
              <span className="text-xs tracking-wide text-muted uppercase">{project.role}</span>
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
