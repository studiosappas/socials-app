import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CurrentPageLabel } from "./nav-tabs";

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
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", projectId)
    .single();

  if (!project) notFound();

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
