import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";

// Shared gate for every /admin/* route (this dashboard, plus the two
// pre-existing pages: landing, thumbnails). Both of those already run this
// exact same is_admin check inline in their own page.tsx -- adding it here
// too is intentionally redundant with them, not a replacement: this layout
// check is a fast, friendly early exit (a real "Access Denied" screen
// instead of a stack trace or a half-rendered page), the same role the
// existing pages' own inline checks already play. It is NOT the real
// security boundary for privileged data -- every Server Action that reads
// or writes admin-only data re-checks is_admin itself, independently, via
// requireAdminServiceClient() (admin-auth.ts), exactly like
// thumbnail-backfill.ts already does. A user who somehow reached a page
// without this layout running still can't get real data out of any admin
// Server Action.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = user
    ? await supabase.from("profiles").select("is_admin").eq("id", user.id).maybeSingle()
    : { data: null };

  if (!profile?.is_admin) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-4 py-24 text-center">
        <p className="text-sm tracking-wide text-muted uppercase">Access Denied</p>
        <p className="text-sm text-muted">This page is restricted to site admins.</p>
        <Link href="/">
          <Button type="button" variant="primary" radius="none">
            Back to Home
          </Button>
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}
