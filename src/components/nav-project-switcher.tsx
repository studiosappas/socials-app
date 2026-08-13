"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useOutsideClick } from "@/lib/hooks/use-outside-click";
import type { NavProject } from "@/lib/nav-data";

// Click-only (not hover) -- a separate interaction from NavProjectMenu's
// page-navigation dropdown, purely for switching which project is active
// (Instagram/Slack-style account/workspace switcher).
export function NavProjectSwitcher({
  projects,
  currentProject,
}: {
  projects: NavProject[];
  currentProject: NavProject;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpenState] = useState(false);
  const menuRef = useOutsideClick<HTMLDivElement>(open, () => setOpenState(false));

  const others = projects.filter((p) => p.id !== currentProject.id);

  function switchTo(projectId: string) {
    setOpenState(false);
    if (projectId === currentProject.id) return;
    // Swap just the projectId path segment so switching projects keeps the
    // user on the same *kind* of page (e.g. Grid -> Grid) whenever the new
    // project has an equivalent route -- a stale sub-path (a postId that
    // doesn't exist in the new project, say) is an acceptable edge case.
    const nextPath = pathname.replace(`/projects/${currentProject.id}`, `/projects/${projectId}`);
    router.push(nextPath);
  }

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpenState((v: boolean) => !v)}
        title={currentProject.name}
        className="block h-6 w-6 shrink-0 overflow-hidden rounded-full border border-border transition-colors duration-150 hover:border-foreground/40"
      >
        {currentProject.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={currentProject.avatarUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center bg-black/[.04] text-[9px] uppercase text-muted">
            {currentProject.name.slice(0, 1)}
          </span>
        )}
      </button>

      <div
        className={`absolute left-0 top-full z-30 pt-2 transition-[opacity,transform] duration-150 ${
          open ? "pointer-events-auto translate-y-0 opacity-100" : "pointer-events-none -translate-y-1 opacity-0"
        }`}
      >
        <div className="w-56 max-w-[calc(100vw-1.5rem)] rounded-none border border-border bg-background py-1 shadow-[0_4px_20px_rgba(0,0,0,0.08)]">
          <ProjectRow project={currentProject} active onClick={() => switchTo(currentProject.id)} />
          {others.map((p) => (
            <ProjectRow key={p.id} project={p} onClick={() => switchTo(p.id)} />
          ))}
          <div className="my-1 border-t border-border" />
          <Link
            href="/projects"
            onClick={() => setOpenState(false)}
            className="block px-3 py-2 text-xs tracking-wide uppercase text-muted transition-colors duration-150 hover:bg-black/[.03] hover:text-foreground"
          >
            + New Project
          </Link>
        </div>
      </div>
    </div>
  );
}

function ProjectRow({
  project,
  active = false,
  onClick,
}: {
  project: NavProject;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors duration-150 hover:bg-black/[.03] ${
        active ? "text-foreground" : "text-muted hover:text-foreground"
      }`}
    >
      <span className="block h-5 w-5 shrink-0 overflow-hidden rounded-full border border-border">
        {project.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={project.avatarUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center bg-black/[.04] text-[8px] uppercase text-muted">
            {project.name.slice(0, 1)}
          </span>
        )}
      </span>
      <span className="truncate">{project.name}</span>
      {active && <span className="ml-auto shrink-0 text-[10px] text-muted">Current</span>}
    </button>
  );
}
