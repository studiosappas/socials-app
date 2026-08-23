"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useOutsideClick } from "@/lib/hooks/use-outside-click";

const PROJECT_PAGES = [
  { href: "", label: "Overview" },
  { href: "grid", label: "Grid" },
  { href: "calendar", label: "Calendar" },
  { href: "stories", label: "Content" },
  { href: "assets", label: "Assets" },
  { href: "brief", label: "Brief" },
  { href: "settings", label: "Settings" },
];

const CLOSE_DELAY_MS = 120;

export function NavProjectMenu({ projectId }: { projectId: string | null }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Closes on an outside tap/click -- the only way to dismiss on touch,
  // where there's no mouseleave to schedule a close from.
  const menuRef = useOutsideClick<HTMLDivElement>(open, () => setOpen(false));

  function cancelClose() {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }

  function scheduleClose() {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  }

  const base = projectId ? `/projects/${projectId}` : null;

  // Same match used to highlight the active row in the dropdown below,
  // reused (not duplicated) to drive the trigger's own label -- "Projects"
  // was always the wrong word here once you're actually inside a project:
  // this dropdown is the app's main page navigation, not a project picker,
  // so the label should say where you ARE (Grid, Calendar, Brief, ...) and
  // the arrow says where else you can go.
  const activePage = base
    ? PROJECT_PAGES.find((page) => (page.href ? pathname.startsWith(`${base}/${page.href}`) : pathname === base))
    : null;
  // Post detail pages -- both the @modal-intercepted overlay opened from a
  // Grid tile and the standalone page reached by a direct URL/hard refresh
  // -- aren't one of PROJECT_PAGES' own destinations (there's no "Posts"
  // entry), but posts are fundamentally Grid content, so the label should
  // still read "Grid" rather than falling back to the generic "Projects"
  // while the user is clearly still deep in that surface. Story detail
  // pages don't need the same treatment -- /stories/[storyId] already
  // starts with the "stories" entry's own href, so it matches directly.
  const isPostDetail = !activePage && base && pathname.startsWith(`${base}/posts/`);
  const label = activePage?.label ?? (isPostDetail ? "Grid" : null) ?? "Projects";

  return (
    // Trigger + panel share one hover zone (mouseenter/leave on this wrapper,
    // not on the trigger and panel separately) -- moving the cursor from
    // "Projects" down into the panel never fires a leave event at all, so
    // there's no dead-zone gap to fight with delay hacks. The short
    // scheduleClose delay is only there to tolerate a brief, accidental
    // flicker off the edge, not to bridge a real gap.
    <div
      ref={menuRef}
      className="relative"
      onMouseEnter={() => {
        if (!base) return;
        cancelClose();
        setOpen(true);
      }}
      onMouseLeave={scheduleClose}
    >
      {base ? (
        // Inside a project, "Projects" no longer navigates directly (the
        // breadcrumb's own "Projects" link already covers that) -- it's the
        // toggle for this dropdown instead, so a tap works the same as a
        // hover would on desktop (touch devices don't reliably fire hover).
        <button
          type="button"
          // Always opens (never toggles closed) -- a tap fires a synthetic
          // mouseenter *and* a click in the same gesture on touch devices,
          // so a toggle here would race the mouseenter's setOpen(true) and
          // immediately flip it back to closed. Closing only ever happens
          // via an outside tap, navigating to a page, or (desktop) mouseleave.
          onClick={() => {
            cancelClose();
            setOpen(true);
          }}
          className="inline-flex items-center gap-1 whitespace-nowrap text-foreground transition-colors duration-150 hover:text-foreground"
        >
          {label}
          <svg
            width="8"
            height="5"
            viewBox="0 0 8 5"
            fill="none"
            className={`shrink-0 transition-transform duration-150 ${open ? "-rotate-180" : ""}`}
          >
            <path d="M1 1L4 4L7 1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      ) : (
        <Link
          href="/projects"
          className="whitespace-nowrap text-muted transition-colors duration-150 hover:text-foreground"
        >
          Projects
        </Link>
      )}

      {base && (
        <div
          className={`absolute left-0 top-full z-30 pt-2 transition-[opacity,transform] duration-150 ${
            open ? "pointer-events-auto translate-y-0 opacity-100" : "pointer-events-none -translate-y-1 opacity-0"
          }`}
        >
          <div className="w-44 max-w-[calc(100vw-1.5rem)] rounded-none border border-border bg-background py-1 shadow-[0_4px_20px_rgba(0,0,0,0.08)]">
            {PROJECT_PAGES.map((page) => {
              const href = page.href ? `${base}/${page.href}` : base;
              const active = page.href ? pathname.startsWith(href) : pathname === base;
              return (
                <Link
                  key={page.href}
                  href={href}
                  onClick={() => setOpen(false)}
                  className={`block px-3 py-2 text-xs tracking-wide uppercase transition-colors duration-150 ${
                    active ? "text-foreground" : "text-muted"
                  } hover:bg-black/[.03] hover:text-foreground`}
                >
                  {page.label}
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
