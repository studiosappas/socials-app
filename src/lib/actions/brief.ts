"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type UpdateBriefState = { message?: string; success?: boolean } | undefined;

export async function updateBrief(
  projectId: string,
  bodyJson: object,
): Promise<UpdateBriefState> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("project_briefs")
    .upsert({ project_id: projectId, body_json: bodyJson }, { onConflict: "project_id" });

  if (error) {
    return { message: error.message };
  }

  revalidatePath(`/projects/${projectId}/brief`);
  return { success: true };
}

export async function uploadBriefImage(
  projectId: string,
  formData: FormData,
): Promise<{ url?: string; message?: string }> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { message: "No file provided." };
  }

  const supabase = await createClient();
  const ext = file.name.includes(".") ? file.name.split(".").pop() : undefined;
  const storagePath = `${projectId}/${crypto.randomUUID()}${ext ? `.${ext}` : ""}`;

  const { error: uploadError } = await supabase.storage
    .from("brief-media")
    .upload(storagePath, file, { contentType: file.type });

  if (uploadError) {
    return { message: uploadError.message };
  }

  const { data } = supabase.storage.from("brief-media").getPublicUrl(storagePath);
  return { url: data.publicUrl };
}
