"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

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

  // "layout" mode so the top nav's project list/switcher (fetched once in
  // projects/layout.tsx, a layout segment the new project's own dynamic
  // [projectId] segment doesn't invalidate on its own) picks up the new
  // project immediately instead of showing it only after some later,
  // unrelated revalidation.
  revalidatePath("/projects", "layout");
  redirect(`/projects/${data.id}/grid`);
}

export async function updateBrandNotes(projectId: string, value: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("projects").update({ brand_notes: value }).eq("id", projectId);
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${projectId}/grid`);
}

export async function updateContentPillars(projectId: string, value: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("projects").update({ content_pillars: value }).eq("id", projectId);
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${projectId}/grid`);
}

export type UpdateGridSettingsState = { message?: string; success?: boolean } | undefined;

// Single combined save for the Grid sidebar's "Edit Profile" modal -- name,
// avatar, username, bio, notes, and content pillars all persist together.
export async function updateProjectProfile(
  projectId: string,
  _state: UpdateGridSettingsState,
  formData: FormData,
): Promise<UpdateGridSettingsState> {
  const supabase = await createClient();

  function weeklyAmount(key: string): number {
    const raw = Number(formData.get(key));
    return Number.isFinite(raw) ? Math.max(0, Math.round(raw)) : 0;
  }

  const platformRaw = String(formData.get("platform") ?? "instagram");
  const platform: "instagram" | "tiktok" | "pinterest" | "youtube" =
    platformRaw === "tiktok" || platformRaw === "pinterest" || platformRaw === "youtube"
      ? platformRaw
      : "instagram";

  const update: {
    ig_display_name: string;
    ig_username: string;
    ig_bio: string;
    brand_notes: string;
    content_pillars: string;
    ig_website_link: string;
    industry: string;
    platform: "instagram" | "tiktok" | "pinterest" | "youtube";
    posts_per_week: number;
    stories_per_week: number;
    reels_per_week: number;
    newsletter_per_week: number;
    profile_photo_path?: string;
  } = {
    ig_display_name: String(formData.get("name") ?? "").trim(),
    ig_username: String(formData.get("username") ?? "").trim(),
    ig_bio: String(formData.get("bio") ?? ""),
    brand_notes: String(formData.get("notes") ?? ""),
    content_pillars: String(formData.get("content_pillars") ?? ""),
    ig_website_link: String(formData.get("website") ?? "").trim(),
    industry: String(formData.get("industry") ?? "").trim(),
    platform,
    posts_per_week: weeklyAmount("posts_per_week"),
    stories_per_week: weeklyAmount("stories_per_week"),
    reels_per_week: weeklyAmount("reels_per_week"),
    newsletter_per_week: weeklyAmount("newsletter_per_week"),
  };

  const photo = formData.get("avatar");
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

  // Isolated from the update above -- instagram_url/tiktok_url are new
  // columns that may not exist yet on a not-yet-migrated database, and
  // PostgREST fails the WHOLE statement if any referenced column is
  // missing. A pending migration means these two links just don't save
  // yet, not that the rest of the profile edit breaks.
  await supabase
    .from("projects")
    .update({
      instagram_url: String(formData.get("instagram_url") ?? "").trim(),
      tiktok_url: String(formData.get("tiktok_url") ?? "").trim(),
    })
    .eq("id", projectId);

  // Custom sections ("Add Section +") are saved as a full replace -- simplest
  // correct approach for a small, single-editor list with no concurrent
  // multi-user editing to reconcile.
  const sectionsRaw = String(formData.get("sections_json") ?? "[]");
  let sections: { title: string; body: string }[] = [];
  try {
    sections = JSON.parse(sectionsRaw);
  } catch {
    sections = [];
  }
  sections = sections.filter((s) => s.title.trim() || s.body.trim());

  await supabase.from("project_sections").delete().eq("project_id", projectId);
  if (sections.length > 0) {
    const { error: sectionsError } = await supabase.from("project_sections").insert(
      sections.map((s, i) => ({
        project_id: projectId,
        title: s.title.trim(),
        body: s.body,
        position: i,
      })),
    );
    if (sectionsError) {
      return { message: sectionsError.message };
    }
  }

  revalidatePath(`/projects/${projectId}/grid`);
  return { success: true };
}
