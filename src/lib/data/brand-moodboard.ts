import { createClient } from "@/lib/supabase/server";
import { getCachedSignedUrls } from "@/lib/signed-url-cache";
import type { BrandMoodboardCategory, BrandMoodboardItemKind } from "@/types/database";

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
  fontFamily: string | null;
  fontWeight: string | null;
  fontStyle: string | null;
};

// One entry per uploaded font FILE -- rows sharing the same familyName are
// different faces (weight/style) of one logical font, exactly like real
// @font-face. Fed to useCustomFonts (lib/use-custom-fonts.ts) to actually
// load them into the browser.
export type CustomFontFace = { familyName: string; weight: string; style: string; url: string };

export function deriveCustomFontFaces(items: BrandMoodboardItem[]): CustomFontFace[] {
  return items
    .filter((i) => i.category === "font" && i.kind === "file" && i.fontFamily && i.fileUrl)
    .map((i) => ({
      familyName: i.fontFamily as string,
      weight: i.fontWeight || "400",
      style: i.fontStyle || "normal",
      url: i.fileUrl as string,
    }));
}

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
  const urlByPath = await getCachedSignedUrls(supabase, "project-media", paths);

  // Isolated from the select above -- font_family/font_weight/font_style are
  // newer columns that may not exist yet on a not-yet-migrated database. A
  // plain .eq()-filtered select failing here just means every item comes
  // back with fontFamily: null, which deriveCustomFontFaces already treats
  // as "not a usable font" -- degrades to zero custom fonts, not a broken page.
  const { data: fontMetaRows } = await supabase
    .from("brand_moodboard_items")
    .select("id, font_family, font_weight, font_style")
    .eq("project_id", projectId);
  const fontMetaById = new Map((fontMetaRows ?? []).map((r) => [r.id, r]));

  return data.map((d) => {
    const fontMeta = fontMetaById.get(d.id);
    return {
      id: d.id,
      category: d.category,
      label: d.label,
      notes: d.notes,
      kind: d.kind,
      fileType: d.storage_path ? fileTypeFromPath(d.storage_path) : null,
      fileUrl: d.storage_path ? urlByPath.get(d.storage_path) ?? null : null,
      linkUrl: d.url,
      fontFamily: fontMeta?.font_family ?? null,
      fontWeight: fontMeta?.font_weight ?? null,
      fontStyle: fontMeta?.font_style ?? null,
    };
  });
}
