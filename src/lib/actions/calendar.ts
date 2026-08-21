"use server";

import { revalidatePath } from "next/cache";
import { format } from "date-fns";
import { createClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity-log";
import { ensureAutoTaskForPost } from "@/lib/actions/task-automation";
import { deriveAutoTaskTitle } from "@/lib/task-title";
import { notifyMentions } from "@/lib/notifications";

export type CalendarItemType = "post" | "story";

export async function scheduleItem(
  projectId: string,
  itemType: CalendarItemType,
  itemId: string,
  date: string | null,
) {
  const supabase = await createClient();
  const table = itemType === "post" ? "posts" : "stories";

  // Reverse of the lazy auto-publish heuristic in calendar/page.tsx: a
  // Published item dragged onto a future date is no longer "already
  // published" and should go back to looking like ordinary scheduled
  // content (white cell) until that date actually arrives again.
  const { data: current } = await supabase.from(table).select("status").eq("id", itemId).single();
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const shouldResetToScheduled = current?.status === "published" && !!date && date > todayStr;

  const { error } = await supabase
    .from(table)
    .update({
      scheduled_date: date,
      ...(shouldResetToScheduled ? { status: "scheduled" } : {}),
    })
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

  // Not revalidating /calendar (its own route) -- the client already moved
  // the item optimistically (see calendar-board.tsx's applySchedule) before
  // this action ever runs. Grid/Stories/Tasks still need to reflect the new
  // date whenever next visited.
  revalidatePath(`/projects/${projectId}/grid`);
  revalidatePath(`/projects/${projectId}/stories`);
  revalidatePath("/tasks");
}

// Manual override of the Calendar's auto-publish heuristic (see the
// date-based lazy flip in calendar/page.tsx) -- toggles straight between
// "published" and "scheduled" rather than trying to recall whatever status
// preceded it, since every item this is called on already has a
// scheduled_date (it only renders on a day cell's own tile).
export async function setItemPublished(
  projectId: string,
  itemType: CalendarItemType,
  itemId: string,
  published: boolean,
) {
  const supabase = await createClient();
  const table = itemType === "post" ? "posts" : "stories";

  const { error } = await supabase
    .from(table)
    .update({ status: published ? "published" : "scheduled" })
    .eq("id", itemId);

  if (error) {
    throw new Error(error.message);
  }

  // Not revalidating /calendar (its own route) -- the publish toggle in
  // calendar-board.tsx already applies this optimistically before the
  // action runs.
  revalidatePath(`/projects/${projectId}/grid`);
  revalidatePath(`/projects/${projectId}/stories`);
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

  // Not revalidating /calendar (its own route) -- every caller (the
  // right-click context menu and DayDetailDialog's own create handler)
  // already calls router.refresh() itself right after, since no
  // optimistic insertion of the new post exists yet. /grid and /tasks are
  // genuinely different routes, kept as-is.
  revalidatePath(`/projects/${projectId}/grid`);
  revalidatePath("/tasks");
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

  // Not revalidating /calendar -- same reasoning as createPostForDate
  // above (every caller already calls router.refresh() itself). /stories
  // is a genuinely different route, kept as-is.
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
    return { success: true };
  }

  if (existing) {
    const { error } = await supabase.from("calendar_notes").update({ body }).eq("id", existing.id);
    if (error) return { success: false, message: error.message };
  } else {
    const { error } = await supabase.from("calendar_notes").insert({ project_id: projectId, date, body });
    if (error) return { success: false, message: error.message };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    const { data: profile } = await supabase.from("profiles").select("name").eq("id", user.id).single();
    await notifyMentions(supabase, projectId, body, {
      notifierName: profile?.name ?? "Someone",
      itemLabel: "a calendar note",
      link: `/projects/${projectId}/calendar`,
      excludeUserId: user.id,
    });
  }

  // Not revalidating /calendar (its own route, only caller) -- the client
  // already applied the note text optimistically (see calendar-board.tsx's
  // handleSaveNote) before this action ever runs.
  return { success: true };
}
