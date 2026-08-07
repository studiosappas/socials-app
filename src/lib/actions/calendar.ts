"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity-log";
import { ensureAutoTaskForPost } from "@/lib/actions/task-automation";
import { deriveAutoTaskTitle } from "@/lib/task-title";

export type CalendarItemType = "post" | "story";

export async function scheduleItem(
  projectId: string,
  itemType: CalendarItemType,
  itemId: string,
  date: string | null,
) {
  const supabase = await createClient();
  const table = itemType === "post" ? "posts" : "stories";

  const { error } = await supabase
    .from(table)
    .update({ scheduled_date: date })
    .eq("id", itemId);

  if (error) {
    throw new Error(error.message);
  }

  // v1 auto-task scope is posts only, per the brief ("starting with
  // scheduled posts from the Calendar") -- stories don't get one yet.
  if (itemType === "post" && date) {
    const { data: post } = await supabase.from("posts").select("caption, post_type").eq("id", itemId).single();
    if (post) {
      await ensureAutoTaskForPost(supabase, projectId, itemId, {
        title: deriveAutoTaskTitle(post.caption, post.post_type, date),
        dueDate: date,
      });
    }
  }

  revalidatePath(`/projects/${projectId}/calendar`);
  revalidatePath(`/projects/${projectId}/grid`);
  revalidatePath(`/projects/${projectId}/stories`);
  revalidatePath("/projects/todo");
}

export async function createPostForDate(projectId: string, date: string): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: post, error } = await supabase
    .from("posts")
    .insert({ project_id: projectId, scheduled_date: date, status: "scheduled" })
    .select("id")
    .single();

  if (error || !post) {
    throw new Error(error?.message ?? "Failed to create post.");
  }

  if (user) await logActivity(supabase, projectId, user.id, "created a post");

  await ensureAutoTaskForPost(supabase, projectId, post.id, {
    title: deriveAutoTaskTitle("", "post", date),
    dueDate: date,
  });

  revalidatePath(`/projects/${projectId}/calendar`);
  revalidatePath(`/projects/${projectId}/grid`);
  revalidatePath("/projects/todo");
  return post.id;
}

export async function createStoryForDate(projectId: string, date: string): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { count } = await supabase
    .from("stories")
    .select("*", { count: "exact", head: true })
    .eq("project_id", projectId);

  const { data: story, error } = await supabase
    .from("stories")
    .insert({
      project_id: projectId,
      name: "Untitled story",
      scheduled_date: date,
      position: count ?? 0,
    })
    .select("id")
    .single();

  if (error || !story) {
    throw new Error(error?.message ?? "Failed to create story.");
  }

  if (user) await logActivity(supabase, projectId, user.id, "created a story");

  revalidatePath(`/projects/${projectId}/calendar`);
  revalidatePath(`/projects/${projectId}/stories`);
  return story.id;
}

export async function upsertCalendarNote(
  projectId: string,
  date: string,
  body: string,
): Promise<{ success: boolean; message?: string }> {
  const supabase = await createClient();

  const { data: existing, error: readError } = await supabase
    .from("calendar_notes")
    .select("id")
    .eq("project_id", projectId)
    .eq("date", date)
    .maybeSingle();

  if (readError) {
    return { success: false, message: readError.message };
  }

  if (!body.trim()) {
    if (existing) {
      const { error } = await supabase.from("calendar_notes").delete().eq("id", existing.id);
      if (error) return { success: false, message: error.message };
    }
    revalidatePath(`/projects/${projectId}/calendar`);
    return { success: true };
  }

  if (existing) {
    const { error } = await supabase.from("calendar_notes").update({ body }).eq("id", existing.id);
    if (error) return { success: false, message: error.message };
  } else {
    const { error } = await supabase.from("calendar_notes").insert({ project_id: projectId, date, body });
    if (error) return { success: false, message: error.message };
  }

  revalidatePath(`/projects/${projectId}/calendar`);
  return { success: true };
}
