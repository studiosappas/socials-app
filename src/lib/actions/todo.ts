"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type TaskFormState = { message?: string; success?: boolean } | undefined;

function normalizeDueDate(formData: FormData): string | null {
  const raw = formData.get("due_date");
  return raw && String(raw).trim() ? String(raw) : null;
}

export async function createTask(
  _state: TaskFormState,
  formData: FormData,
): Promise<TaskFormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { message: "Not signed in." };

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { message: "Title is required." };

  const { error } = await supabase.from("tasks").insert({
    user_id: user.id,
    title,
    notes: String(formData.get("notes") ?? ""),
    due_date: normalizeDueDate(formData),
  });

  if (error) return { message: error.message };
  revalidatePath("/projects/todo");
  return { success: true };
}

export async function updateTask(
  taskId: string,
  _state: TaskFormState,
  formData: FormData,
): Promise<TaskFormState> {
  const supabase = await createClient();
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { message: "Title is required." };

  const { error } = await supabase
    .from("tasks")
    .update({
      title,
      notes: String(formData.get("notes") ?? ""),
      due_date: normalizeDueDate(formData),
    })
    .eq("id", taskId);

  if (error) return { message: error.message };
  revalidatePath("/projects/todo");
  return { success: true };
}

export async function toggleTaskCompleted(taskId: string, completed: boolean) {
  const supabase = await createClient();
  await supabase.from("tasks").update({ completed }).eq("id", taskId);
  revalidatePath("/projects/todo");
}

export async function deleteTask(taskId: string) {
  const supabase = await createClient();
  await supabase.from("tasks").delete().eq("id", taskId);
  revalidatePath("/projects/todo");
}

export async function convertToTask(
  projectId: string,
  sourceType: "post" | "story",
  sourceId: string,
  title: string,
  dueDate: string | null,
): Promise<{ success: boolean; message?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "Not signed in." };

  const { data: existing } = await supabase
    .from("tasks")
    .select("id")
    .eq("user_id", user.id)
    .eq("source_type", sourceType)
    .eq("source_id", sourceId)
    .maybeSingle();
  if (existing) return { success: true };

  const { error } = await supabase.from("tasks").insert({
    user_id: user.id,
    project_id: projectId,
    title,
    due_date: dueDate,
    source_type: sourceType,
    source_id: sourceId,
  });
  if (error) {
    console.error("convertToTask insert failed:", error.message);
    return { success: false, message: error.message };
  }

  revalidatePath("/projects/todo");
  revalidatePath(`/projects/${projectId}/calendar`);
  return { success: true };
}
