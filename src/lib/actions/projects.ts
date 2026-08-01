"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { Platform } from "@/types/database";

export async function createProject(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data, error } = await supabase
    .from("projects")
    .insert({ name, created_by: user.id })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to create project");
  }

  redirect(`/projects/${data.id}/grid`);
}

export type UpdateGridSettingsState = { message?: string; success?: boolean } | undefined;

export async function updateGridSettings(
  projectId: string,
  _state: UpdateGridSettingsState,
  formData: FormData,
): Promise<UpdateGridSettingsState> {
  const supabase = await createClient();

  const update = {
    brand_notes: String(formData.get("brand_notes") ?? ""),
    platform: String(formData.get("platform") ?? "instagram") as Platform,
    ig_handle: String(formData.get("ig_handle") ?? ""),
    show_scheduled_dates: formData.get("show_scheduled_dates") === "on",
  };

  const { error } = await supabase.from("projects").update(update).eq("id", projectId);

  if (error) {
    return { message: error.message };
  }

  revalidatePath(`/projects/${projectId}/grid`);
  return { success: true };
}

export async function updateProfilePreview(
  projectId: string,
  _state: UpdateGridSettingsState,
  formData: FormData,
): Promise<UpdateGridSettingsState> {
  const supabase = await createClient();

  const update: {
    ig_username: string;
    ig_display_name: string;
    ig_bio: string;
    ig_posts_count: number;
    ig_followers_count: number;
    ig_following_count: number;
    ig_website_link: string;
    profile_photo_path?: string;
  } = {
    ig_username: String(formData.get("ig_username") ?? ""),
    ig_display_name: String(formData.get("ig_display_name") ?? ""),
    ig_bio: String(formData.get("ig_bio") ?? ""),
    ig_posts_count: Number(formData.get("ig_posts_count") ?? 0) || 0,
    ig_followers_count: Number(formData.get("ig_followers_count") ?? 0) || 0,
    ig_following_count: Number(formData.get("ig_following_count") ?? 0) || 0,
    ig_website_link: String(formData.get("ig_website_link") ?? ""),
  };

  const photo = formData.get("profile_photo");
  if (photo instanceof File && photo.size > 0) {
    const ext = photo.name.includes(".") ? photo.name.split(".").pop() : undefined;
    const storagePath = `${projectId}/profile-photo${ext ? `.${ext}` : ""}`;

    const { error: uploadError } = await supabase.storage
      .from("project-media")
      .upload(storagePath, photo, { contentType: photo.type, upsert: true });

    if (uploadError) {
      return { message: uploadError.message };
    }

    update.profile_photo_path = storagePath;
  }

  const { error } = await supabase.from("projects").update(update).eq("id", projectId);

  if (error) {
    return { message: error.message };
  }

  revalidatePath(`/projects/${projectId}/grid`);
  return { success: true };
}
