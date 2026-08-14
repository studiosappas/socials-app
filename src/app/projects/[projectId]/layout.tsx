import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { CurrentPageLabel } from "./nav-tabs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ProjectLayout({
  children,
  modal,
  params,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  // projects.id is a uuid column -- a non-uuid-shaped value here can never
  // be a real project. This used to be reachable in practice: /projects/todo
  // (a static route once nested here as a sibling of this dynamic segment)
  // shared this segment's exact path depth/prefix, and this segment also
  // owns parallel/intercepting routes (@modal) -- Next's client router
  // treated the two as related enough to occasionally resolve THIS layout
  // for the literal projectId "todo", corrupting real navigations right
  // after. That route has since moved to /tasks (see app-header.tsx), which
  // structurally can't collide with this segment at all; this guard just
  // stays on as cheap defense against any other malformed value.
  if (!UUID_RE.test(projectId)) return null;

  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", projectId)
    .single();

  // Covers both "this project doesn't exist" and "it exists but you're not
  // a member" -- RLS's own is_project_member/created_by check already makes
  // those indistinguishable at the query level (a non-member's select just
  // returns no row, same as a genuinely missing project id), and the two
  // cases warrant the same response anyway: you don't have access to this.
  // Reaching this layout at all means middleware already confirmed the
  // visitor is authenticated, so this is specifically the "signed in, no
  // permission" case Client Review Mode's access-denied screen calls for.
  if (!project) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-4 py-24 text-center">
        <p className="text-sm tracking-wide text-muted uppercase">Access Denied</p>
        <p className="text-sm text-muted">
          You don&apos;t have access to this project. If you were invited, check that you&apos;re signed in with the
          right account, or ask the project admin to confirm your invite.
        </p>
        <Link href="/projects">
          <Button type="button" variant="primary" radius="none">
            Back to Projects
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <header className="px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-6xl items-center gap-2 overflow-x-auto whitespace-nowrap text-xs tracking-wide text-muted uppercase [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <Link href="/projects" className="shrink-0 transition-colors duration-150 hover:text-foreground">
            Projects
          </Link>
          <span className="shrink-0">/</span>
          <span className="shrink-0">{project.name}</span>
          <span className="shrink-0">/</span>
          <span className="shrink-0">
            <CurrentPageLabel projectId={projectId} />
          </span>
        </div>
      </header>
      <div className="mx-auto w-full max-w-6xl flex-1 p-4 sm:p-6">{children}</div>
      {modal}
    </div>
  );
}
