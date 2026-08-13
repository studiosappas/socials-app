import type { createClient } from "@/lib/supabase/server";
import type { LandingContentKey } from "@/lib/landing/content-context";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// Isolated from every other query on this page -- landing_demo_content is a
// new, possibly-not-yet-migrated table (same "pending migration" convention
// as the rest of this app: an isolated query here means a database that
// hasn't run the migration yet just gets every key's shipped default,
// never a broken landing page).
export async function getLandingContentOverrides(
  supabase: SupabaseServerClient,
): Promise<Partial<Record<LandingContentKey, unknown>>> {
  const { data } = await supabase.from("landing_demo_content").select("key, value");
  const overrides: Partial<Record<LandingContentKey, unknown>> = {};
  for (const row of data ?? []) {
    overrides[row.key as LandingContentKey] = row.value;
  }
  return overrides;
}
