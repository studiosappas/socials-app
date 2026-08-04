"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/lib/actions/auth";

export function AppHeader() {
  const pathname = usePathname();
  const onAccount = pathname.startsWith("/account");
  const onTodo = pathname.startsWith("/projects/todo");
  const onProjects = !onAccount && !onTodo;

  return (
    <header className="px-6 py-4">
      <div className="mx-auto flex max-w-6xl items-center justify-between">
        <Link href="/projects" className="text-sm tracking-wide">
          SOCIALS APP
        </Link>
        <nav className="flex items-center gap-6 text-xs tracking-wide uppercase">
          <Link
            href="/projects"
            className={`transition-colors duration-150 hover:text-foreground ${
              onProjects ? "font-semibold text-foreground" : "text-muted"
            }`}
          >
            Projects
          </Link>
          <Link
            href="/projects/todo"
            className={`transition-colors duration-150 hover:text-foreground ${
              onTodo ? "font-semibold text-foreground" : "text-muted"
            }`}
          >
            To Do List
          </Link>
          <Link
            href="/account"
            className={`transition-colors duration-150 hover:text-foreground ${
              onAccount ? "font-semibold text-foreground" : "text-muted"
            }`}
          >
            Account
          </Link>
          <form action={logout}>
            <button
              type="submit"
              className="normal-case text-muted transition-colors duration-150 hover:text-foreground"
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
      Powered by Studio Sappas
    </footer>
  );
}
