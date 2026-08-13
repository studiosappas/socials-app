import { createClient } from "@/lib/supabase/server";
import type { BrandMoodboardCategory } from "@/types/database";

const SIGNED_URL_TTL_SECONDS = 3600;

export type BrandMoodboardItem = {
  id: string;
  category: BrandMoodboardCategory;
  label: string;
  notes: string;
  url: string | null;
};

// Isolated from every other Brief query -- brand_moodboard_items may not
// exist yet on a not-yet-migrated database, and a missing moodboard should
// degrade to "no items yet" rather than breaking the whole Brief page.
export async function getBrandMoodboard(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
): Promise<BrandMoodboardItem[]> {
  const { data } = await supabase
    .from("brand_moodboard_items")
    .select("id, category, storage_path, label, notes")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (!data || data.length === 0) return [];

  const paths = data.map((d) => d.storage_path);
  const { data: signedUrls } = await supabase.storage.from("project-media").createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
  const urlByPath = new Map((signedUrls ?? []).map((s) => [s.path, s.signedUrl]));

  return data.map((d) => ({
    id: d.id,
    category: d.category,
    label: d.label,
    notes: d.notes,
    url: d.storage_path ? urlByPath.get(d.storage_path) ?? null : null,
  }));
}
