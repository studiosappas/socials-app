"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { BriefFrameSection, BriefItemSection, BriefTaskType } from "@/types/database";

const DEFAULT_FRAME_LABELS = ["Cover", "Body 1", "Body 2", "Closure"];

type ActionResult = { success: boolean; message?: string };

export async function createBriefTask(
  projectId: string,
  position: number,
): Promise<ActionResult & { taskId?: string }> {
  const supabase = await createClient();

  const { data: task, error } = await supabase
    .from("brief_tasks")
    .insert({ project_id: projectId, name: `Task ${String(position + 1).padStart(2, "0")}`, position })
    .select("id")
    .single();

  if (error || !task) {
    return { success: false, message: error?.message ?? "Failed to create task." };
  }

  const frameRows = (["frames", "text"] as BriefFrameSection[]).flatMap((section) =>
    DEFAULT_FRAME_LABELS.map((label, i) => ({
      task_id: task.id,
      section,
      label,
      position: i,
    })),
  );
  const { error: frameError } = await supabase.from("brief_task_frames").insert(frameRows);
  if (frameError) {
    return { success: false, message: frameError.message };
  }

  revalidatePath(`/projects/${projectId}/brief`);
  return { success: true, taskId: task.id };
}

export async function renameBriefTask(
  projectId: string,
  taskId: string,
  name: string,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("brief_tasks")
    .update({ name: name.trim() || "Task" })
    .eq("id", taskId);
  if (error) return { success: false, message: error.message };
  revalidatePath(`/projects/${projectId}/brief`);
  return { success: true };
}

export async function setBriefTaskTypes(
  projectId: string,
  taskId: string,
  contentTypes: BriefTaskType[],
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("brief_tasks").update({ content_types: contentTypes }).eq("id", taskId);
  if (error) return { success: false, message: error.message };
  revalidatePath(`/projects/${projectId}/brief`);
  return { success: true };
}

export async function deleteBriefTask(projectId: string, taskId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("brief_tasks").delete().eq("id", taskId);
  if (error) return { success: false, message: error.message };
  revalidatePath(`/projects/${projectId}/brief`);
  return { success: true };
}

export async function addBriefTaskLink(
  projectId: string,
  taskId: string,
  section: BriefItemSection,
  url: string,
  notes: string,
  position: number,
): Promise<ActionResult> {
  if (!url.trim()) return { success: false, message: "URL is required." };
  const supabase = await createClient();
  const { error } = await supabase.from("brief_task_items").insert({
    task_id: taskId,
    section,
    kind: "link",
    url: url.trim(),
    label: url.trim(),
    notes: notes.trim(),
    position,
  });
  if (error) return { success: false, message: error.message };
  revalidatePath(`/projects/${projectId}/brief`);
  return { success: true };
}

export async function addBriefTaskImage(
  projectId: string,
  taskId: string,
  section: BriefItemSection,
  notes: string,
  position: number,
  formData: FormData,
): Promise<ActionResult> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { success: false, message: "No file provided." };
  }

  const supabase = await createClient();
  const ext = file.name.includes(".") ? file.name.split(".").pop() : undefined;
  const storagePath = `${projectId}/${crypto.randomUUID()}${ext ? `.${ext}` : ""}`;

  const { error: uploadError } = await supabase.storage
    .from("brief-media")
    .upload(storagePath, file, { contentType: file.type });
  if (uploadError) {
    return { success: false, message: uploadError.message };
  }

  const { data: attachment, error: attachmentError } = await supabase
    .from("brief_attachments")
    .insert({ project_id: projectId, original_storage_path: storagePath })
    .select("id")
    .single();
  if (attachmentError || !attachment) {
    return { success: false, message: attachmentError?.message ?? "Failed to save attachment." };
  }

  const { error: itemError } = await supabase.from("brief_task_items").insert({
    task_id: taskId,
    section,
    kind: "image",
    label: file.name,
    notes: notes.trim(),
    attachment_id: attachment.id,
    position,
  });
  if (itemError) return { success: false, message: itemError.message };

  revalidatePath(`/projects/${projectId}/brief`);
  return { success: true };
}

export async function removeBriefTaskItem(projectId: string, itemId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("brief_task_items").delete().eq("id", itemId);
  if (error) return { success: false, message: error.message };
  revalidatePath(`/projects/${projectId}/brief`);
  return { success: true };
}

export async function addBriefTaskFrame(
  projectId: string,
  taskId: string,
  section: BriefFrameSection,
  position: number,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("brief_task_frames")
    .insert({ task_id: taskId, section, label: `Text ${position + 1}`, position });
  if (error) return { success: false, message: error.message };
  revalidatePath(`/projects/${projectId}/brief`);
  return { success: true };
}

export async function renameBriefTaskFrame(
  projectId: string,
  frameId: string,
  label: string,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("brief_task_frames")
    .update({ label: label.trim() || "Text" })
    .eq("id", frameId);
  if (error) return { success: false, message: error.message };
  revalidatePath(`/projects/${projectId}/brief`);
  return { success: true };
}

export async function updateBriefTaskFrameBody(
  projectId: string,
  frameId: string,
  body: string,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("brief_task_frames").update({ body }).eq("id", frameId);
  if (error) return { success: false, message: error.message };
  revalidatePath(`/projects/${projectId}/brief`);
  return { success: true };
}

export async function removeBriefTaskFrame(projectId: string, frameId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("brief_task_frames").delete().eq("id", frameId);
  if (error) return { success: false, message: error.message };
  revalidatePath(`/projects/${projectId}/brief`);
  return { success: true };
}

export async function saveBriefAnnotation(
  projectId: string,
  attachmentId: string,
  formData: FormData,
): Promise<{ previewUrl?: string; message?: string }> {
  const file = formData.get("file");
  const annotationJsonRaw = formData.get("annotation_json");
  if (!(file instanceof File) || file.size === 0) {
    return { message: "No preview image provided." };
  }
  if (typeof annotationJsonRaw !== "string") {
    return { message: "Missing annotation data." };
  }

  let annotationJson: object;
  try {
    annotationJson = JSON.parse(annotationJsonRaw);
  } catch {
    return { message: "Invalid annotation data." };
  }

  const supabase = await createClient();
  const storagePath = `${projectId}/${crypto.randomUUID()}-preview.jpg`;

  const { error: uploadError } = await supabase.storage
    .from("brief-media")
    .upload(storagePath, file, { contentType: file.type });

  if (uploadError) {
    return { message: uploadError.message };
  }

  const { error: updateError } = await supabase
    .from("brief_attachments")
    .update({ preview_storage_path: storagePath, annotation_json: annotationJson })
    .eq("id", attachmentId);

  if (updateError) {
    return { message: updateError.message };
  }

  const { data } = supabase.storage.from("brief-media").getPublicUrl(storagePath);
  revalidatePath(`/projects/${projectId}/brief`);
  return { previewUrl: data.publicUrl };
}
