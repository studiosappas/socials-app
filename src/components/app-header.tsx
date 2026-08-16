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
  homeHref = "/projects",
}: {
  projects?: NavProject[];
  notificationItems?: NotificationItem[];
  unreadCount?: number;
  // Where the logo links -- resolved server-side from the signed-in user's
  // Account > Workspace "Default Home Page" setting (see
  // account-settings.ts's resolveLandingPath, shared with the post-login
  // redirect). Defaults to /projects for logged-out renders.
  homeHref?: string;
}) {
  const pathname = usePathname();
  const onAccount = pathname.startsWith("/account");
  const onTodo = pathname.startsWith("/tasks");

  const match = pathname.match(/^\/projects\/([^/]+)(?:\/|$)/);
  const currentProjectId = match ? match[1] : null;
  const currentProject = projects.find((p) => p.id === currentProjectId) ?? null;

  return (
    <header className="px-4 py-4 sm:px-6">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <Link
          href={homeHref}
          className="shrink-0 whitespace-nowrap text-xl font-semibold font-[family-name:var(--font-fraunces)] tracking-wide"
        >
          Flow:er
        </Link>
        <nav className="flex flex-nowrap items-center gap-x-2 rounded-full bg-foreground/[0.04] px-2.5 py-1.5 text-xs tracking-wide uppercase sm:gap-x-4 sm:gap-6 sm:px-4 sm:py-2">
          <NavNotificationBell items={notificationItems} unreadCount={unreadCount} />
          <div className="flex items-center gap-2">
            {currentProject && <NavProjectSwitcher projects={projects} currentProject={currentProject} />}
            <NavProjectMenu projectId={currentProjectId} />
          </div>
          {/* /tasks, not /projects/todo -- a static route sharing the same
              path depth/prefix as the dynamic /projects/[projectId] segment
              (which has its own @modal parallel/intercepting routes) caused
              Next's client router to intermittently resolve THIS link's
              destination using [projectId]'s parallel-route state, corrupting
              real project navigations that happened right after. Moving this
              page fully outside /projects/* removes the structural ambiguity
              entirely, rather than working around its symptoms. */}
          <Link
            href="/tasks"
            className={`whitespace-nowrap transition-colors duration-150 hover:text-foreground ${
              onTodo ? "font-semibold text-foreground" : "text-muted"
            }`}
          >
            <span className="sm:hidden">Tasks</span>
            <span className="hidden sm:inline">To Do List</span>
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
    <footer className="grid grid-cols-3 items-center gap-4 px-6 py-10">
      <FlowMark className="h-9 w-9 shrink-0 text-foreground" />
      <p className="text-center text-xs tracking-wide text-muted uppercase">by ASAP Labs</p>
      <p className="justify-self-end text-right text-[10px] leading-tight tracking-wide text-muted uppercase">
        designed by
        <br />
        <span className="text-foreground">Studio Sappas</span>
      </p>
    </footer>
  );
}

// The "Flow" mark on its own -- same glyph as favicon/icon.svg's pinwheel-S
// shape, just the bare squares with no circle backing, sized for inline use
// next to text.
function FlowMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" fill="currentColor" className={className}>
      <rect x="29" y="29" width="27" height="27" rx="6" />
      <rect x="64" y="29" width="27" height="27" rx="6" />
      <rect x="29" y="64" width="27" height="27" rx="6" />
      <rect x="64" y="64" width="27" height="27" rx="6" />
      <rect x="43" y="54.5" width="34" height="11" rx="5.5" transform="rotate(45 60 60)" />
    </svg>
  );
}
