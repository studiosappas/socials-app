"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { BrandMoodboardCategory } from "@/types/database";

type ActionResult = { success: boolean; message?: string };

const FONT_EXTENSIONS = new Set(["ttf", "otf", "woff", "woff2"]);

// Same upload shape as grid.ts's uploadMedia -- files live in the same
// project-media bucket every other project asset already uses, just tagged
// with a moodboard category instead of becoming a Grid/post media_asset.
//
// fontMeta is only ever passed for category "font" -- everything else in
// this app trusts file.type/extension with zero server-side validation, but
// a font file that isn't actually a font just silently fails to render
// anywhere it's used (FontFace().load() rejects), so this is the one
// deliberate exception: reject before the upload if the extension isn't a
// real font format.
export async function uploadMoodboardItem(
  projectId: string,
  category: BrandMoodboardCategory,
  label: string,
  formData: FormData,
  fontMeta?: { fontFamily: string; fontWeight: string; fontStyle: string },
): Promise<ActionResult> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { success: false, message: "Choose a file to upload." };
  }

  const ext = file.name.includes(".") ? file.name.split(".").pop()?.toLowerCase() : undefined;

  if (category === "font" && (!ext || !FONT_EXTENSIONS.has(ext))) {
    return { success: false, message: "Unsupported font file -- use .woff, .woff2, .ttf, or .otf." };
  }

  const supabase = await createClient();
  const storagePath = `${projectId}/${crypto.randomUUID()}${ext ? `.${ext}` : ""}`;

  const { error: uploadError } = await supabase.storage
    .from("project-media")
    .upload(storagePath, file, { contentType: file.type });
  if (uploadError) return { success: false, message: uploadError.message };

  const { error } = await supabase.from("brand_moodboard_items").insert({
    project_id: projectId,
    category,
    kind: "file",
    storage_path: storagePath,
    label: label.trim() || file.name,
    ...(fontMeta
      ? { font_family: fontMeta.fontFamily, font_weight: fontMeta.fontWeight, font_style: fontMeta.fontStyle }
      : {}),
  });
  if (error) return { success: false, message: error.message };

  revalidatePath(`/projects/${projectId}/brief`);
  return { success: true };
}

// Same category set as uploaded files -- a link (e.g. a Pinterest board, a
// hosted brand guideline page) is style/reference context exactly like an
// uploaded image, it just has no file to store.
export async function addMoodboardLink(
  projectId: string,
  category: BrandMoodboardCategory,
  label: string,
  url: string,
): Promise<ActionResult> {
  const trimmedUrl = url.trim();
  if (!trimmedUrl) return { success: false, message: "URL is required." };

  const supabase = await createClient();
  const { error } = await supabase.from("brand_moodboard_items").insert({
    project_id: projectId,
    category,
    kind: "link",
    url: trimmedUrl,
    label: label.trim() || trimmedUrl,
  });
  if (error) return { success: false, message: error.message };

  revalidatePath(`/projects/${projectId}/brief`);
  return { success: true };
}

// DB row only, same as deleteMedia in grid.ts -- the storage object is left
// in place rather than deleted.
export async function deleteMoodboardItem(projectId: string, itemId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("brand_moodboard_items").delete().eq("id", itemId);
  if (error) return { success: false, message: error.message };
  revalidatePath(`/projects/${projectId}/brief`);
  return { success: true };
}
