import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// A second, separate Supabase client construction -- deliberately NOT
// exported from server.ts (the normal, session-bound client every regular
// action uses) so it can never be reached by accident. This one uses the
// service-role key, which bypasses Row Level Security entirely: it can
// read and write every row in every table, in every project, regardless
// of who created it or who's logged in.
//
// That makes it fundamentally different from every other Supabase client
// in this app, so it comes with hard rules:
//   - Never call this before the caller has already verified (via the
//     normal, session-bound client) that the real logged-in user is a
//     site admin. This file itself does not check anything -- the caller
//     (thumbnail-backfill.ts's requireAdminServiceClient) is the actual
//     gate.
//   - Never import this from a "use client" file or anything that could
//     end up in a browser bundle. It has no "use client"/"use server"
//     directive itself because it isn't meant to be called directly from
//     either boundary -- only from already-gated server-only helpers.
//   - Never return the client instance itself (or raw query results from
//     it) to the browser without re-applying the same access checks the
//     normal RLS policies would have enforced.
export function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set in this environment. This admin tool needs it to see across every project -- add it as an environment variable (server-side only, never NEXT_PUBLIC_) and redeploy.",
    );
  }
  return createClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
