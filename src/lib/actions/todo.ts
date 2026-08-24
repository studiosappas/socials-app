"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getTaskComments, type TaskCommentItem } from "@/lib/data/tasks";
import { notifyMentions } from "@/lib/notifications";
import type { TaskStatus } from "@/types/database";

export type TaskFormState = { message?: string; success?: boolean; taskId?: string } | undefined;

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

  const { data, error } = await supabase
    .from("tasks")
    .insert({
      user_id: user.id,
      project_id: projectId,
      title,
      notes: String(formData.get("notes") ?? ""),
      due_date: normalizeDueDate(formData),
      assignee_id: assigneeId,
    })
    .select("id")
    .single();

  if (error) return { message: error.message };
  // Not revalidating -- its one caller (NewTaskDialog) already inserts the
  // new task optimistically and reconciles the real id returned here.
  return { success: true, taskId: data?.id };
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

export type TaskMutationResult = { success: true } | { success: false; message: string };

// Not revalidating -- its one caller (task-workspace.tsx's
// handleStatusChange) already applies the change optimistically via
// overrideTasks before this action ever runs, and reverts it if this
// reports failure.
//
// A plain `.update(...).eq(...)` with no `.select()` returns NO error when
// RLS's USING clause filters the row out -- Postgres/PostgREST treat "0 rows
// matched" and "1 row matched and was updated" identically at the HTTP
// level for UPDATE/DELETE (unlike INSERT, where a WITH CHECK violation IS a
// real error). A Viewer/Client whose write gets correctly blocked by RLS
// would therefore see `error` stay null and have no way to know the write
// never happened. Chaining `.select("id")` forces PostgREST to return the
// actually-affected rows, so an RLS-filtered write is distinguishable from
// a real one by checking `data.length` -- this is the fix.
export async function updateTaskStatus(taskId: string, status: TaskStatus): Promise<TaskMutationResult> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", taskId)
    .select("id");
  if (error) return { success: false, message: "Couldn't update that task's status." };
  if (!data || data.length === 0) {
    return { success: false, message: "You don't have permission to change this task's status." };
  }
  return { success: true };
}

// Not revalidating -- same reasoning as updateTaskStatus above
// (task-workspace.tsx's handleAssigneeChange already applies this
// optimistically via overrideTasks and reverts on failure). Same
// 0-rows-affected-is-not-an-error caveat applies -- see updateTaskStatus.
export async function updateTaskAssignee(taskId: string, assigneeId: string | null): Promise<TaskMutationResult> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .update({ assignee_id: assigneeId, updated_at: new Date().toISOString() })
    .eq("id", taskId)
    .select("id");
  if (error) return { success: false, message: "Couldn't reassign that task." };
  if (!data || data.length === 0) {
    return { success: false, message: "You don't have permission to reassign this task." };
  }
  return { success: true };
}

// Not revalidating -- its one caller (task-detail.tsx's handleDelete)
// already hides the task optimistically before this runs, and only
// restores it + surfaces a toast if the delete actually failed. Same
// 0-rows-affected-is-not-an-error caveat as updateTaskStatus above applies
// to DELETE too -- `.select("id")` is what makes an RLS-blocked delete
// distinguishable from a real one instead of silently reporting success.
export async function deleteTask(taskId: string): Promise<TaskMutationResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("tasks").delete().eq("id", taskId).select("id");
  if (error) return { success: false, message: "Couldn't delete that task." };
  if (!data || data.length === 0) {
    return { success: false, message: "You don't have permission to delete this task." };
  }
  return { success: true };
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
