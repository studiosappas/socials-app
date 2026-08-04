"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "", label: "Overview" },
  { href: "grid", label: "Grid" },
  { href: "stories", label: "Stories" },
  { href: "calendar", label: "Calendar" },
  { href: "brief", label: "Brief" },
  { href: "settings", label: "Settings" },
];

export function CurrentPageLabel({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const base = `/projects/${projectId}`;
  const active = NAV_ITEMS.find((item) => {
    const href = item.href ? `${base}/${item.href}` : base;
    return item.href ? pathname.startsWith(href) : pathname === base;
  });
  return <span className="text-foreground">{active?.label ?? ""}</span>;
}

export function NavTabs({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const base = `/projects/${projectId}`;

  return (
    <nav className="flex gap-6 text-xs tracking-wide uppercase">
      {NAV_ITEMS.map((item) => {
        const href = item.href ? `${base}/${item.href}` : base;
        const active = item.href ? pathname.startsWith(href) : pathname === base;
        return (
          <Link
            key={item.href}
            href={href}
            className={`pb-1 transition-colors duration-150 ${
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
  );
}
