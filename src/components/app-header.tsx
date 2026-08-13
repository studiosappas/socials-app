"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/lib/actions/auth";
import { NavProjectMenu } from "@/components/nav-project-menu";
import { NavProjectSwitcher } from "@/components/nav-project-switcher";
import { NavNotificationBell } from "@/components/nav-notification-bell";
import type { NavProject } from "@/lib/nav-data";
import type { NotificationItem } from "@/lib/notifications-data";

export function AppHeader({
  projects = [],
  notificationItems = [],
  unreadCount = 0,
}: {
  projects?: NavProject[];
  notificationItems?: NotificationItem[];
  unreadCount?: number;
}) {
  const pathname = usePathname();
  const onAccount = pathname.startsWith("/account");
  const onTodo = pathname.startsWith("/projects/todo");

  // "/projects/todo" and "/projects/[projectId]/..." share the same first
  // path segment -- "todo" is the one literal value there that's never a
  // real projectId, so it's excluded explicitly rather than assumed away.
  const match = pathname.match(/^\/projects\/([^/]+)(?:\/|$)/);
  const currentProjectId = match && match[1] !== "todo" ? match[1] : null;
  const currentProject = projects.find((p) => p.id === currentProjectId) ?? null;

  return (
    <header className="px-4 py-4 sm:px-6">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <Link
          href="/projects"
          className="shrink-0 whitespace-nowrap text-xl font-semibold font-[family-name:var(--font-fraunces)] tracking-wide"
        >
          Flow
        </Link>
        <nav className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-full bg-foreground/[0.04] px-4 py-2 text-xs tracking-wide uppercase sm:gap-6">
          <NavNotificationBell items={notificationItems} unreadCount={unreadCount} />
          <div className="flex items-center gap-2">
            {currentProject && <NavProjectSwitcher projects={projects} currentProject={currentProject} />}
            <NavProjectMenu projectId={currentProjectId} />
          </div>
          <Link
            href="/projects/todo"
            className={`whitespace-nowrap transition-colors duration-150 hover:text-foreground ${
              onTodo ? "font-semibold text-foreground" : "text-muted"
            }`}
          >
            To Do List
          </Link>
          <Link
            href="/account"
            className={`whitespace-nowrap transition-colors duration-150 hover:text-foreground ${
              onAccount ? "font-semibold text-foreground" : "text-muted"
            }`}
          >
            Account
          </Link>
          <form action={logout}>
            <button
              type="submit"
              className="whitespace-nowrap normal-case text-muted transition-colors duration-150 hover:text-foreground"
            >
              log out
            </button>
          </form>
        </nav>
      </div>
    </header>
  );
}

export function AppFooter() {
  return (
    <footer className="px-6 py-10 text-center text-xs tracking-wide text-muted uppercase">
      by ASAP Labs
    </footer>
  );
}
