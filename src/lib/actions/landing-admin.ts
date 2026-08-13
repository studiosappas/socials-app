"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { LANDING_CONTENT_KEYS, type LandingContentKey } from "@/lib/landing/content-context";
import type { Database, Json } from "@/types/database";

type LandingDemoContentInsert = Database["public"]["Tables"]["landing_demo_content"]["Insert"];

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, ok: false as const, message: "Not signed in." };

  const { data: profile } = await supabase.from("profiles").select("is_admin").eq("id", user.id).single();
  if (!profile?.is_admin) return { supabase, ok: false as const, message: "Not authorized." };

  return { supabase, ok: true as const, userId: user.id };
}

export async function upsertLandingContent(
  key: LandingContentKey,
  value: Json,
): Promise<{ success: boolean; message?: string }> {
  if (!LANDING_CONTENT_KEYS.includes(key)) return { success: false, message: "Unknown content key." };

  const admin = await requireAdmin();
  if (!admin.ok) return { success: false, message: admin.message };

  const row: LandingDemoContentInsert = { key, value, updated_at: new Date().toISOString() };
  const { error } = await admin.supabase.from("landing_demo_content").upsert(row);
  if (error) return { success: false, message: error.message };

  revalidatePath("/");
  revalidatePath("/admin/landing");
  return { success: true };
}

export async function resetLandingContent(key: LandingContentKey): Promise<{ success: boolean; message?: string }> {
  const admin = await requireAdmin();
  if (!admin.ok) return { success: false, message: admin.message };

  const { error } = await admin.supabase.from("landing_demo_content").delete().eq("key", key);
  if (error) return { success: false, message: error.message };

  revalidatePath("/");
  revalidatePath("/admin/landing");
  return { success: true };
}

// Uploads to the public landing-media bucket and returns the storage path
// (not a full URL -- the bucket is public, so any consumer can build the
// URL from the path via getPublicUrl, same as avatars/brief-media do
// today). Paste the returned path into a MediaRef's `src` field in the
// content JSON to point that image at the new file.
export async function uploadLandingImage(formData: FormData): Promise<{ path?: string; message?: string }> {
  const admin = await requireAdmin();
  if (!admin.ok) return { message: admin.message };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { message: "Choose a file to upload." };

  const ext = file.name.includes(".") ? file.name.split(".").pop() : undefined;
  const path = `uploads/${crypto.randomUUID()}${ext ? `.${ext}` : ""}`;

  const { error } = await admin.supabase.storage
    .from("landing-media")
    .upload(path, file, { contentType: file.type });
  if (error) return { message: error.message };

  return { path };
}
