"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

// Called every ~90s by <PresenceHeartbeat> (mounted in the authenticated app
// shells -- projects/layout.tsx, tasks/layout.tsx, account/layout.tsx) while
// the tab is visible. user_presence has no RLS policies at all (see
// fix_admin_dashboard_schema.sql), so this has to go through the
// service-role client to write anything -- identity is established first via
// the normal, cookie-bound client, exactly like every other admin-adjacent
// check in this codebase (see admin-auth.ts), just without an is_admin
// requirement: any authenticated user may report their own presence, only
// admins may ever read the aggregate back.
export async function updateLastSeen(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const serviceClient = createServiceRoleClient();
  await serviceClient.from("user_presence").upsert({ user_id: user.id, last_seen_at: new Date().toISOString() });
}
