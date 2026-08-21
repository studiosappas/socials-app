import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { getThumbnailBackfillStatus } from "@/lib/actions/thumbnail-backfill";
import { ThumbnailBackfillPanel } from "./thumbnail-backfill-panel";

// Same admin gate as /admin/landing (profiles.is_admin) -- but note that
// flag only controls whether this PAGE renders; the actual backfill work
// still runs through the normal authenticated Supabase client, so it's
// still bound by ordinary project_members RLS underneath (see
// thumbnail-backfill.ts's own comment).
//
// Deliberately no maxDuration export here -- this page's own render only
// ever runs a handful of cheap status queries (see getThumbnailBackfillStatus),
// never the slow download+resize+upload work, so it doesn't need Vercel's
// default function timeout raised. The one action that does (
// runThumbnailBackfillBatch) sets its own maxDuration directly on
// thumbnail-backfill.ts instead, scoped to just that invocation.
export default async function AdminThumbnailsPage() {
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

  // Caught explicitly (rather than letting a thrown error hit Next's
  // generic "a server error occurred" page) so a real failure here is
  // actually diagnosable -- this is admin-only tooling nobody but you will
  // ever see, so showing the real message is safe and, without any way
  // for me to read Vercel's own runtime logs directly, it's the fastest
  // path to finding the real cause if this ever breaks again.
  let status: Awaited<ReturnType<typeof getThumbnailBackfillStatus>> | null = null;
  let loadError: string | null = null;
  try {
    status = await getThumbnailBackfillStatus();
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-12 sm:px-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-light">Thumbnail Backfill</h1>
        <p className="text-sm text-muted">
          Generates a lightweight display thumbnail for existing images that don&apos;t have one yet (uploaded
          before the thumbnail pipeline existed). Originals are never modified, replaced, or removed — this only
          ever adds a new, separate small file and points the Grid at it for display. Export, download, and PDF
          keep using the original at full quality regardless.
        </p>
      </div>
      {loadError || !status ? (
        <div className="rounded border border-error/40 bg-error/5 p-4 text-sm text-error">
          Couldn&apos;t load the thumbnail status: {loadError ?? "unknown error"}
        </div>
      ) : (
        <ThumbnailBackfillPanel initialStatus={status} />
      )}
    </div>
  );
}
