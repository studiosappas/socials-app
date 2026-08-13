import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getLandingContentOverrides } from "@/lib/landing-content-data";
import { LandingPage } from "./landing-page";

export default async function RootPage() {
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
