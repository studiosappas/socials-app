import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CurrentPageLabel, NavTabs } from "./nav-tabs";

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
      <header className="px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-2 text-xs tracking-wide text-muted uppercase">
            <Link href="/projects" className="transition-colors duration-150 hover:text-foreground">
              Projects
            </Link>
            <span>/</span>
            <span>{project.name}</span>
            <span>/</span>
            <CurrentPageLabel projectId={projectId} />
          </div>
          <NavTabs projectId={projectId} />
        </div>
      </header>
      <div className="mx-auto w-full max-w-6xl flex-1 p-6">{children}</div>
      {modal}
    </div>
  );
}
