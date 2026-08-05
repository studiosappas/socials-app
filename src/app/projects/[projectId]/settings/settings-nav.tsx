"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const SETTINGS_NAV_ITEMS = [
  { href: "", label: "Project Information" },
  { href: "team", label: "Team & Permissions" },
  { href: "notifications", label: "Notifications" },
  { href: "activity", label: "Activity Log" },
  { href: "danger", label: "Danger Zone" },
];

// Shared by both the desktop sidebar and mobile tab strip below -- same
// active-match logic as the project-level NavTabs (nav-tabs.tsx).
function isActive(pathname: string, base: string, href: string) {
  const full = href ? `${base}/${href}` : base;
  return href ? pathname.startsWith(full) : pathname === base;
}

export function SettingsNav({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const base = `/projects/${projectId}/settings`;

  return (
    <>
      {/* Mobile: horizontal scrollable tab strip, same pattern as the
          project-level NavTabs -- every section stays one tap away instead
          of behind a hamburger menu. Hidden at lg, where the vertical
          sidebar below takes over. */}
      <nav className="flex gap-6 overflow-x-auto pb-2 text-xs tracking-wide uppercase [-ms-overflow-style:none] [scrollbar-width:none] lg:hidden [&::-webkit-scrollbar]:hidden">
        {SETTINGS_NAV_ITEMS.map((item) => {
          const href = item.href ? `${base}/${item.href}` : base;
          const active = isActive(pathname, base, item.href);
          return (
            <Link
              key={item.href}
              href={href}
              className={`shrink-0 pb-1 transition-colors duration-150 ${
                active
                  ? "border-b border-foreground text-foreground"
                  : "border-b border-transparent text-muted hover:text-foreground"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Desktop: vertical sidebar, matches the wireframe. */}
      <nav className="hidden w-56 shrink-0 flex-col gap-5 lg:flex">
        {SETTINGS_NAV_ITEMS.map((item) => {
          const href = item.href ? `${base}/${item.href}` : base;
          const active = isActive(pathname, base, item.href);
          return (
            <Link
              key={item.href}
              href={href}
              className={`text-sm tracking-wide uppercase transition-colors duration-150 ${
                active ? "font-semibold text-foreground" : "text-muted hover:text-foreground"
              } ${item.label === "Danger Zone" ? "mt-4" : ""}`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
