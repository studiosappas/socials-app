import Link from "next/link";
import { Button } from "@/components/ui/button";

// Same visual pattern as this project tree's other "you can't be here"
// state -- layout.tsx's non-member Access Denied screen -- reused for the
// narrower "you're a member, but this page isn't in your permissions" case.
// Rendered in place of a page's real content on the server, so nothing that
// page would normally fetch/show is ever sent to the browser for a
// restricted viewer -- not just hidden client-side.
export function AccessRestricted() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-4 py-24 text-center">
      <p className="text-sm tracking-wide text-muted uppercase">Access Restricted</p>
      <p className="text-sm text-muted">
        You don&apos;t have access to this page. Ask a project owner or admin to grant it in Team &amp; Permissions.
      </p>
      {/* Not a link back into this same project (e.g. its Overview) -- a
          role/permission combination that's restricted here could just as
          easily be restricted there too, turning "Back" into another dead
          end. /projects is the one destination every signed-in member can
          always reach regardless of any project-specific permission. */}
      <Link href="/projects">
        <Button type="button" variant="primary" radius="none">
          Back to Projects
        </Button>
      </Link>
    </div>
  );
}
