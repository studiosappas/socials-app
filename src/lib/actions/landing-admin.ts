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

// The file itself already went direct browser-to-Storage before this ever
// runs (see admin-landing-form.tsx's handleFileChange) -- the same "Admins
// manage landing media" RLS policy that used to gate this upload already
// gates that direct one identically, so this is just a final admin check
// before handing back the path to paste into a MediaRef's `src` field.
export async function uploadLandingImage(formData: FormData): Promise<{ path?: string; message?: string }> {
  const admin = await requireAdmin();
  if (!admin.ok) return { message: admin.message };

  const path = formData.get("storagePath");
  if (typeof path !== "string" || !path) return { message: "Choose a file to upload." };

  return { path };
}
