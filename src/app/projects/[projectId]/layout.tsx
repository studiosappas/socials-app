import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const NAV_ITEMS = [
  { href: "", label: "Overview" },
  { href: "grid", label: "Grid" },
  { href: "calendar", label: "Calendar" },
  { href: "stories", label: "Stories" },
  { href: "brief", label: "Brief" },
  { href: "members", label: "Members" },
];

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
      <header className="border-b border-border px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-2 text-xs tracking-wide text-muted uppercase">
            <Link href="/projects" className="hover:text-foreground">
              ← Clients
            </Link>
            <span>/</span>
            <span className="text-foreground">{project.name}</span>
          </div>
          <nav className="flex gap-6 text-xs tracking-wide uppercase">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href ? `/projects/${projectId}/${item.href}` : `/projects/${projectId}`}
                className="text-muted hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <div className="mx-auto w-full max-w-6xl flex-1 p-6">{children}</div>
      {modal}
    </div>
  );
}
