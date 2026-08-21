import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { getThumbnailBackfillStatus } from "@/lib/actions/thumbnail-backfill";
import { ThumbnailBackfillPanel } from "./thumbnail-backfill-panel";

// Same admin gate as /admin/landing (profiles.is_admin) -- but note that
// flag only controls whether this PAGE renders; the actual backfill work
// still runs through the normal authenticated Supabase client, so it's
// still bound by ordinary project_members RLS underneath (see
// thumbnail-backfill.ts's own comment). Raised past Vercel's default
// function timeout since a single batch downloads+resizes+uploads several
// multi-MB originals in sequence.
export const maxDuration = 60;

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

  const status = await getThumbnailBackfillStatus();

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
      <ThumbnailBackfillPanel initialStatus={status} />
    </div>
  );
}
