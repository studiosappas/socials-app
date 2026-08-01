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

  const projects = (memberships ?? [])
    .map((m) => ({ ...m.projects, role: m.role }))
    .filter((p): p is NonNullable<typeof p> => Boolean(p?.id));

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
              className="flex items-center justify-between px-1 py-4 hover:bg-black/[0.02]"
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
