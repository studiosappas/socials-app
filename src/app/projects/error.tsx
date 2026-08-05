"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

// A safety net, not a feature -- catches a crash ANYWHERE under /projects
// (a page, a modal, a single misbehaving widget) so it can never blank the
// whole app the way an uncaught client-side render error otherwise would
// (there was no error boundary anywhere in this app before this file, so a
// single crash had nowhere to stop and took everything down with it). The
// surrounding layout (top nav, project switcher) stays mounted regardless --
// only this segment's content is replaced, so there's always a way back out.
export default function ProjectsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Projects section error:", error);
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-4 py-24 text-center">
      <p className="text-sm tracking-wide text-muted uppercase">Something went wrong</p>
      <p className="text-sm text-muted">
        This page hit an error, but nothing was deleted — your projects are still there. Try again, or head back to
        your projects list.
      </p>
      <div className="flex gap-3">
        <Button type="button" variant="primary" radius="none" onClick={reset}>
          Try again
        </Button>
        <Link
          href="/projects"
          className="flex items-center rounded-none border border-foreground px-4 py-2 text-sm transition-colors duration-150 hover:bg-black/[.04]"
        >
          Back to Projects
        </Link>
      </div>
    </div>
  );
}
