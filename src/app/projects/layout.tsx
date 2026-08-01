import Link from "next/link";
import { logout } from "@/lib/actions/auth";

export default function ProjectsShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-border px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <Link href="/projects" className="text-sm tracking-wide">
            SOCIAL PLANNER
          </Link>
          <nav className="flex items-center gap-6 text-xs tracking-wide text-muted uppercase">
            <Link href="/projects" className="hover:text-foreground">
              Clients
            </Link>
            <form action={logout}>
              <button type="submit" className="hover:text-foreground">
                Logout
              </button>
            </form>
          </nav>
        </div>
      </header>
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}
