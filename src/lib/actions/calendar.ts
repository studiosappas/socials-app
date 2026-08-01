"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

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

  revalidatePath(`/projects/${projectId}/calendar`);
  revalidatePath(`/projects/${projectId}/grid`);
  revalidatePath(`/projects/${projectId}/stories`);
}

export async function createPostForDate(projectId: string, date: string): Promise<string> {
  const supabase = await createClient();

  const { data: post, error } = await supabase
    .from("posts")
    .insert({ project_id: projectId, scheduled_date: date, status: "scheduled" })
    .select("id")
    .single();

  if (error || !post) {
    throw new Error(error?.message ?? "Failed to create post.");
  }

  revalidatePath(`/projects/${projectId}/calendar`);
  revalidatePath(`/projects/${projectId}/grid`);
  return post.id;
}

export async function createStoryForDate(projectId: string, date: string): Promise<string> {
  const supabase = await createClient();

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

  revalidatePath(`/projects/${projectId}/calendar`);
  revalidatePath(`/projects/${projectId}/stories`);
  return story.id;
}

export async function upsertCalendarNote(projectId: string, date: string, body: string) {
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("calendar_notes")
    .select("id")
    .eq("project_id", projectId)
    .eq("date", date)
    .maybeSingle();

  if (!body.trim()) {
    if (existing) {
      await supabase.from("calendar_notes").delete().eq("id", existing.id);
    }
    revalidatePath(`/projects/${projectId}/calendar`);
    return;
  }

  if (existing) {
    await supabase.from("calendar_notes").update({ body }).eq("id", existing.id);
  } else {
    await supabase.from("calendar_notes").insert({ project_id: projectId, date, body });
  }

  revalidatePath(`/projects/${projectId}/calendar`);
}
