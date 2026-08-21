"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getTaskComments, type TaskCommentItem } from "@/lib/data/tasks";
import { notifyMentions } from "@/lib/notifications";
import type { TaskStatus } from "@/types/database";

export type TaskFormState = { message?: string; success?: boolean } | undefined;

function normalizeDueDate(formData: FormData): string | null {
  const raw = formData.get("due_date");
  return raw && String(raw).trim() ? String(raw) : null;
}

function normalizeOptional(formData: FormData, key: string): string | null {
  const raw = formData.get(key);
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

  const projectId = normalizeOptional(formData, "project_id");
  // An assignee only makes sense once there's a project team to draw from --
  // a personal (no-project) task ignores whatever assignee_id was posted.
  const assigneeId = projectId ? normalizeOptional(formData, "assignee_id") : null;

  const { error } = await supabase.from("tasks").insert({
    user_id: user.id,
    project_id: projectId,
    title,
    notes: String(formData.get("notes") ?? ""),
    due_date: normalizeDueDate(formData),
    assignee_id: assigneeId,
  });

  if (error) return { message: error.message };
  revalidatePath("/tasks");
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
      updated_at: new Date().toISOString(),
    })
    .eq("id", taskId);

  if (error) return { message: error.message };
  revalidatePath("/tasks");
  return { success: true };
}

// Not revalidating -- its one caller (task-workspace.tsx's
// handleStatusChange) already applies the change optimistically via
// overrideTasks before this action ever runs.
export async function updateTaskStatus(taskId: string, status: TaskStatus) {
  const supabase = await createClient();
  await supabase.from("tasks").update({ status, updated_at: new Date().toISOString() }).eq("id", taskId);
}

// Not revalidating -- same reasoning as updateTaskStatus above
// (task-workspace.tsx's handleAssigneeChange already applies this
// optimistically via overrideTasks).
export async function updateTaskAssignee(taskId: string, assigneeId: string | null) {
  const supabase = await createClient();
  await supabase.from("tasks").update({ assignee_id: assigneeId, updated_at: new Date().toISOString() }).eq("id", taskId);
}

// Not revalidating -- its one caller (task-detail.tsx's handleDelete)
// already calls router.refresh() itself right after this resolves.
export async function deleteTask(taskId: string) {
  const supabase = await createClient();
  await supabase.from("tasks").delete().eq("id", taskId);
}

export async function addTaskComment(
  taskId: string,
  text: string,
): Promise<{ success: boolean; message?: string }> {
  const trimmed = text.trim();
  if (!trimmed) return { success: false, message: "Comment can't be empty." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "Not signed in." };

  const { error } = await supabase.from("task_comments").insert({
    task_id: taskId,
    author_id: user.id,
    text: trimmed,
  });
  if (error) return { success: false, message: error.message };

  // Mentions only make sense against a real project's member list --
  // personal (project_id null) tasks have no team to resolve @names against.
  const { data: task } = await supabase.from("tasks").select("project_id").eq("id", taskId).single();
  if (task?.project_id) {
    const { data: profile } = await supabase.from("profiles").select("name").eq("id", user.id).single();
    await notifyMentions(supabase, task.project_id, trimmed, {
      notifierName: profile?.name ?? "Someone",
      itemLabel: "a task",
      link: "/tasks",
      excludeUserId: user.id,
    });
  }

  // Not revalidating -- its one caller (task-detail.tsx's
  // handleSubmitComment) already shows the new comment optimistically and
  // re-fetches the real thread directly via fetchTaskComments, independent
  // of any full-page revalidation.
  return { success: true };
}

export async function fetchTaskComments(taskId: string): Promise<TaskCommentItem[]> {
  const supabase = await createClient();
  return getTaskComments(supabase, taskId);
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
    .eq("project_id", projectId)
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

  revalidatePath("/tasks");
  revalidatePath(`/projects/${projectId}/calendar`);
  return { success: true };
}
