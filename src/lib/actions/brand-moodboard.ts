"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { BrandMoodboardCategory } from "@/types/database";

type ActionResult = { success: boolean; message?: string };

const FONT_EXTENSIONS = new Set(["ttf", "otf", "woff", "woff2"]);

// The file itself already went direct browser-to-Storage (see
// direct-upload.ts's uploadFileDirect, called from brand-moodboard-dialog.tsx)
// before this action ever runs -- bypasses Vercel's hard, non-configurable
// ~4.5MB Function request-body limit that a FormData-through-this-action
// upload was previously bound by. This only ever receives the resulting
// storagePath + the original fileName (for the label default and the font
// extension check below), never the raw file.
//
// fontMeta is only ever passed for category "font" -- everything else in
// this app trusts file.type/extension with zero server-side validation, but
// a font file that isn't actually a font just silently fails to render
// anywhere it's used (FontFace().load() rejects), so this is the one
// deliberate exception: reject if the extension isn't a real font format.
export async function uploadMoodboardItem(
  projectId: string,
  category: BrandMoodboardCategory,
  label: string,
  storagePath: string,
  fileName: string,
  fontMeta?: { fontFamily: string; fontWeight: string; fontStyle: string },
): Promise<ActionResult> {
  if (!storagePath) {
    return { success: false, message: "Choose a file to upload." };
  }

  const ext = fileName.includes(".") ? fileName.split(".").pop()?.toLowerCase() : undefined;

  if (category === "font" && (!ext || !FONT_EXTENSIONS.has(ext))) {
    return { success: false, message: "Unsupported font file -- use .woff, .woff2, .ttf, or .otf." };
  }

  const supabase = await createClient();

  const { error } = await supabase.from("brand_moodboard_items").insert({
    project_id: projectId,
    category,
    kind: "file",
    storage_path: storagePath,
    label: label.trim() || fileName,
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
