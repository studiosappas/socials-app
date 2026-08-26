"use client";

import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "overview", label: "Overview" },
  { href: "grid", label: "Grid" },
  { href: "calendar", label: "Calendar" },
  { href: "stories", label: "Content" },
  { href: "assets", label: "Assets" },
  { href: "brief", label: "Brief" },
  { href: "settings", label: "Settings" },
];

export function CurrentPageLabel({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const base = `/projects/${projectId}`;
  const active = NAV_ITEMS.find((item) => pathname.startsWith(`${base}/${item.href}`));
  return <span className="text-foreground">{active?.label ?? ""}</span>;
}

// NavTabs itself (the always-visible tab row this file used to also export)
// was removed as part of the navigation redesign -- project-page navigation
// now lives in the top nav's hover dropdown (components/nav-project-menu.tsx).
// NAV_ITEMS stays here since CurrentPageLabel (the breadcrumb's trailing
// "/ Grid" segment) still needs it.
