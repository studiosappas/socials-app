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
  userFirstName = null,
}: {
  projects?: NavProject[];
  notificationItems?: NotificationItem[];
  unreadCount?: number;
  // Where the logo links -- resolved server-side from the signed-in user's
  // Account > Workspace "Default Home Page" setting (see
  // account-settings.ts's resolveLandingPath, shared with the post-login
  // redirect). Defaults to /projects for logged-out renders.
  homeHref?: string;
  // From profiles.name (see nav-data.ts's getUserDisplayFirstName) -- null
  // for a logged-out render or a user with no name saved yet, in which case
  // the nav item falls back to the plain "Account" label below.
  userFirstName?: string | null;
}) {
  const pathname = usePathname();
  const onAccount = pathname.startsWith("/account");
  const onTodo = pathname.startsWith("/tasks");

  const match = pathname.match(/^\/projects\/([^/]+)(?:\/|$)/);
  const currentProjectId = match ? match[1] : null;
  const currentProject = projects.find((p) => p.id === currentProjectId) ?? null;

  return (
    <header className="px-4 py-4 sm:px-6">
      {/* Explicit column->row switch at a fixed viewport width, not organic
          flex-wrap -- flex-wrap's wrap point depends on the SUM of the
          logo's width and the nav pill's width, and the nav pill's width
          now varies with the current-page label (see NavProjectMenu):
          short labels like "Grid"/"Brief" fit beside the logo at a width
          where longer ones like "Overview"/"Calendar" still correctly wrap
          below it, so the header's row/stacked layout silently differed
          per PAGE instead of per viewport -- exactly the real-device bug
          (Grid sitting beside the logo on mobile) this fixes. 430px is
          where the original, always-8-characters "Projects" label itself
          organically wrapped, so this keeps the existing wrap point for
          desktop-ish widths intact while making it deterministic (same for
          every label) rather than incidental. */}
      <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-x-4 gap-y-2 min-[430px]:flex-row min-[430px]:items-center">
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
            <NavProjectMenu
              projectId={currentProjectId}
              role={currentProject?.role}
              customPermissions={currentProject?.customPermissions}
            />
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
            To Do
          </Link>
          {/* Icon + first name, not a second circular avatar -- the project
              avatar already occupies that visual role in this same nav, and
              a second one right next to it would read as two projects, not
              a project + a user. This is WHO is signed in, not another
              project. Falls back to the plain "Account" label (no icon)
              whenever there's no usable name, so it never renders broken or
              empty text. */}
          <Link
            href="/account"
            className={`flex min-w-0 items-center gap-1 whitespace-nowrap transition-colors duration-150 hover:text-foreground ${
              onAccount ? "font-semibold text-foreground" : "text-muted"
            }`}
          >
            {userFirstName ? (
              <>
                {/* The header was already at essentially zero horizontal
                    margin at 320px with the plain "Account" label -- full
                    icon + a generous name width only kicks in from 375px
                    (same min-[375px] convention already used for this
                    app's other 320/375/390/414 responsive tuning, see
                    post-editor.tsx's asset grid). Below that, the icon
                    (purely decorative; the name alone still fully
                    identifies the signed-in user) drops and the name
                    truncates tighter, so "log out" never clips off the
                    edge on the smallest phones. */}
                <PersonIcon className="hidden h-4 w-4 shrink-0 min-[375px]:inline-block" />
                <span className="max-w-[52px] truncate min-[375px]:max-w-[90px]">{userFirstName}</span>
              </>
            ) : (
              "Account"
            )}
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

// Minimal outline person glyph, matching nav-notification-bell.tsx's own
// BellIcon (24x24 viewBox, stroke-only, currentColor, strokeWidth 1.5) so
// the two nav icons read as the same icon language rather than a mismatched
// new style.
function PersonIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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
