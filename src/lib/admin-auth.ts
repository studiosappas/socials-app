import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// Shared by every admin-only Server Action that needs to see across the
// whole system (every project/user, not just ones the caller happens to be
// a member of) -- extracted from thumbnail-backfill.ts, which had its own
// private copy before this dashboard needed the same check a second place.
//
// Ordinary RLS scopes almost everything in this app to project_members, so
// cross-project reads have to go through the service-role client, which
// bypasses RLS completely. That means THIS check is the only thing standing
// between "any logged-in user" and full cross-project read access, so it
// deliberately runs on the normal, session-bound client (the real
// cookie-based identity of whoever is making the request) -- never on the
// service-role client itself, which has no concept of "who's asking" at
// all. The service-role client is only ever constructed and returned after
// this passes.
export async function requireAdminServiceClient(): Promise<SupabaseClient<Database>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("You must be logged in.");
  const { data: profile, error } = await supabase.from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
  if (error) throw new Error(`Couldn't check admin status: ${error.message}`);
  if (!profile?.is_admin) throw new Error("This tool is restricted to site admins.");
  return createServiceRoleClient();
}
