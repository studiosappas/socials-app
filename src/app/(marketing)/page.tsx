import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getLandingContentOverrides } from "@/lib/landing-content-data";
import { LandingPage } from "./landing-page";

export default async function RootPage() {
  // process.env.VERCEL is set to "1" on every Vercel deployment (production
  // AND preview) and is never set in local `next dev` -- the landing page
  // isn't ready for public visibility yet (demo data, unfinished Chapter 02
  // work), so it only renders locally; any real deployment sends visitors
  // straight to login instead. Remove this check once the page is ready to
  // go public.
  if (process.env.VERCEL) redirect("/login");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) redirect("/projects");

  // Anonymous-readable (RLS: "Anyone can read landing demo content") --
  // only keys an admin has actually edited come back here; anything else
  // falls back to its shipped default inside LandingContentProvider.
  const overrides = await getLandingContentOverrides(supabase);

  return <LandingPage overrides={overrides} />;
}
