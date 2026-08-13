import { createClient } from "@/lib/supabase/server";
import type { BrandMoodboardCategory, BrandMoodboardItemKind } from "@/types/database";

const SIGNED_URL_TTL_SECONDS = 3600;

// fileType is derived from the storage_path's own extension, purely so the
// UI/generation code knows how to treat a 'file' item -- render it as an
// image thumbnail, a generic font chip, or a generic PDF chip, and (for
// generation) whether it's safe to send as vision input at all.
export type BrandMoodboardFileType = "image" | "font" | "pdf" | "other";

export type BrandMoodboardItem = {
  id: string;
  category: BrandMoodboardCategory;
  label: string;
  notes: string;
  kind: BrandMoodboardItemKind;
  fileType: BrandMoodboardFileType | null;
  fileUrl: string | null;
  linkUrl: string | null;
};

const FONT_EXTENSIONS = new Set(["ttf", "otf", "woff", "woff2"]);
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "svg"]);

function fileTypeFromPath(path: string): BrandMoodboardFileType {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "pdf";
  if (FONT_EXTENSIONS.has(ext)) return "font";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  return "other";
}

// Isolated from every other Brief query -- brand_moodboard_items may not
// exist yet on a not-yet-migrated database, and a missing moodboard should
// degrade to "no items yet" rather than breaking the whole Brief page.
export async function getBrandMoodboard(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
): Promise<BrandMoodboardItem[]> {
  const { data } = await supabase
    .from("brand_moodboard_items")
    .select("id, category, kind, storage_path, url, label, notes")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (!data || data.length === 0) return [];

  const paths = data.map((d) => d.storage_path).filter((p): p is string => Boolean(p));
  const { data: signedUrls } = paths.length
    ? await supabase.storage.from("project-media").createSignedUrls(paths, SIGNED_URL_TTL_SECONDS)
    : { data: [] };
  const urlByPath = new Map((signedUrls ?? []).map((s) => [s.path, s.signedUrl]));

  return data.map((d) => ({
    id: d.id,
    category: d.category,
    label: d.label,
    notes: d.notes,
    kind: d.kind,
    fileType: d.storage_path ? fileTypeFromPath(d.storage_path) : null,
    fileUrl: d.storage_path ? urlByPath.get(d.storage_path) ?? null : null,
    linkUrl: d.url,
  }));
}
