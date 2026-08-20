"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { detectProvider } from "@/lib/asset-providers";
import type { AssetProvider, AssetType } from "@/types/database";

export type AddAssetCollectionState = { message?: string; success?: boolean } | undefined;

const VALID_PROVIDERS: AssetProvider[] = ["google_drive", "dropbox", "box", "onedrive", "collect", "other"];
const VALID_ASSET_TYPES: AssetType[] = [
  "product_photography",
  "campaign",
  "lifestyle",
  "packaging",
  "ugc",
  "moodboard",
  "videos",
  "references",
  "other",
];

type ParsedFields =
  | { ok: true; folderUrl: string; name: string; provider: AssetProvider; assetType: AssetType; notes: string }
  | { ok: false; message: string };

function parseFields(formData: FormData): ParsedFields {
  const folderUrl = String(formData.get("folder_url") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  if (!folderUrl) return { ok: false, message: "Paste a folder link first." };
  if (!name) return { ok: false, message: "Give the collection a name." };
  try {
    new URL(folderUrl);
  } catch {
    return { ok: false, message: "That doesn't look like a valid URL." };
  }

  // "Auto" from the form means the client-side detector (same function, run
  // again here rather than trusted from the client) couldn't tell -- fall
  // back to whatever the user picked manually in that case.
  const manualProvider = String(formData.get("provider") ?? "");
  const provider: AssetProvider =
    detectProvider(folderUrl) ?? (VALID_PROVIDERS.includes(manualProvider as AssetProvider) ? (manualProvider as AssetProvider) : "other");

  const assetTypeRaw = String(formData.get("asset_type") ?? "other");
  const assetType: AssetType = VALID_ASSET_TYPES.includes(assetTypeRaw as AssetType) ? (assetTypeRaw as AssetType) : "other";

  const notes = String(formData.get("notes") ?? "").trim();

  return { ok: true, folderUrl, name, provider, assetType, notes };
}

// Manual, not automatic -- there's no provider integration to pull a cover
// from the folder's actual contents, so this is the only way a collection
// gets a real cover instead of the placeholder icon. The cover itself
// already went direct browser-to-Storage before this action ever runs (see
// asset-board.tsx's handleSubmit) -- this only ever receives the resulting
// storage path, never the raw file.
function coverStoragePathFrom(formData: FormData): string | null {
  const path = formData.get("cover_storage_path");
  return typeof path === "string" && path ? path : null;
}

export async function addAssetCollection(
  projectId: string,
  _state: AddAssetCollectionState,
  formData: FormData,
): Promise<AddAssetCollectionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { message: "You must be logged in." };

  const fields = parseFields(formData);
  if (!fields.ok) return { message: fields.message };

  const coverStoragePath = coverStoragePathFrom(formData);

  const { error } = await supabase.from("asset_collections").insert({
    project_id: projectId,
    folder_url: fields.folderUrl,
    provider: fields.provider,
    name: fields.name,
    asset_type: fields.assetType,
    notes: fields.notes,
    cover_storage_path: coverStoragePath,
    created_by: user.id,
  });

  if (error) return { message: error.message };

  revalidatePath(`/projects/${projectId}/assets`);
  return { success: true };
}

export async function updateAssetCollection(
  collectionId: string,
  projectId: string,
  _state: AddAssetCollectionState,
  formData: FormData,
): Promise<AddAssetCollectionState> {
  const supabase = await createClient();

  const fields = parseFields(formData);
  if (!fields.ok) return { message: fields.message };

  // Only replaces the cover if a new file was actually picked -- otherwise
  // the existing one (if any) stays exactly as it was.
  const coverStoragePath = coverStoragePathFrom(formData);

  const update: {
    folder_url: string;
    provider: AssetProvider;
    name: string;
    asset_type: AssetType;
    notes: string;
    cover_storage_path?: string;
  } = {
    folder_url: fields.folderUrl,
    provider: fields.provider,
    name: fields.name,
    asset_type: fields.assetType,
    notes: fields.notes,
  };
  if (coverStoragePath) update.cover_storage_path = coverStoragePath;

  const { error } = await supabase.from("asset_collections").update(update).eq("id", collectionId);
  if (error) return { message: error.message };

  revalidatePath(`/projects/${projectId}/assets`);
  return { success: true };
}

export async function deleteAssetCollection(projectId: string, collectionId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("asset_collections").delete().eq("id", collectionId);
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${projectId}/assets`);
}
