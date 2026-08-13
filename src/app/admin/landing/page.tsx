import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { getLandingContentOverrides } from "@/lib/landing-content-data";
import { LANDING_CONTENT_DEFAULTS } from "@/lib/landing/content-context";
import { AdminLandingForm } from "./admin-landing-form";

export default async function AdminLandingPage() {
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

  const overrides = await getLandingContentOverrides(supabase);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-12 sm:px-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-light">Landing Demo Content Manager</h1>
        <p className="text-sm text-muted">
          Edit the demo data the public landing page (/) renders. Each key below is one piece of content — save a
          key to override its shipped default; reset to go back to the default. Changes are live immediately, no
          deploy needed.
        </p>
      </div>
      <AdminLandingForm defaults={LANDING_CONTENT_DEFAULTS} overrides={overrides} />
    </div>
  );
}
