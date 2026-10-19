import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCachedSignedUrls } from "@/lib/signed-url-cache";
import { getUserProjectLists } from "@/lib/project-lists";
import { Avatar } from "@/components/ui/avatar";
import { CreateProjectButton } from "./create-project-button";

export default async function ProjectsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Active projects only, in the same order as the top nav's switcher --
  // both read getUserProjectLists (see project-lists.ts), which also owns
  // the "a missing/failed archived check must never mean an unfiltered or
  // silently-empty list" handling that used to live inline here.
  const [lists, { data: profile }] = await Promise.all([
    getUserProjectLists(user!.id),
    supabase.from("profiles").select("name, email, avatar_url").eq("id", user!.id).single(),
  ]);
  const projects = lists.ok ? lists.active : [];

  // Same batch/cached signed-URL helper the top nav's project switcher
  // already uses for this exact column (see nav-data.ts's
  // getUserProjectsForNav) -- one cache entry per storage path, shared
  // across pages, no per-row signing.
  const avatarPaths = projects.map((p) => p.profilePhotoPath).filter((p): p is string => Boolean(p));
  const urlByPath = await getCachedSignedUrls(supabase, "project-media", avatarPaths);

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
              href={`/projects/${project.id}/overview`}
              className="flex items-center gap-3 px-1 py-4 transition-[transform,background-color] duration-100 hover:bg-black/[0.02] active:scale-[0.98] active:bg-black/[0.04]"
            >
              <Avatar
                name={project.name}
                avatarUrl={project.profilePhotoPath ? (urlByPath.get(project.profilePhotoPath) ?? null) : null}
                size="md"
              />
              <span className="min-w-0 flex-1 truncate text-sm tracking-wide uppercase">{project.name}</span>
              <span className="shrink-0 text-xs tracking-wide text-muted uppercase">{project.role}</span>
            </Link>
          </li>
        ))}
        {!lists.ok && (
          <p role="alert" className="py-4 text-sm text-error">
            We couldn&apos;t load your projects right now. Nothing was deleted — refresh the page to try again.
          </p>
        )}
        {lists.ok && projects.length === 0 && (
          <p className="py-4 text-sm text-muted">No projects yet — create one above.</p>
        )}
      </ul>
    </main>
  );
}
