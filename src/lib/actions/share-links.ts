"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type CreateShareLinkState = { message?: string; success?: boolean; token?: string } | undefined;

export async function createShareLink(
  projectId: string,
  _state: CreateShareLinkState,
  formData: FormData,
): Promise<CreateShareLinkState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { message: "You must be logged in." };

  const title = String(formData.get("title") ?? "").trim();
  const postIds = formData.getAll("post_ids").map(String);
  const storyIds = formData.getAll("story_ids").map(String);
  if (postIds.length === 0 && storyIds.length === 0) {
    return { message: "Select at least one post or story to share." };
  }

  // Ordered by scheduled date (undated last), then created date -- gives
  // the client a sensible chronological read-through without needing a
  // manual reorder step.
  const [{ data: posts }, { data: stories }] = await Promise.all([
    postIds.length
      ? supabase.from("posts").select("id, scheduled_date, created_at").in("id", postIds)
      : Promise.resolve({ data: [] as { id: string; scheduled_date: string | null; created_at: string }[] }),
    storyIds.length
      ? supabase.from("stories").select("id, scheduled_date, created_at").in("id", storyIds)
      : Promise.resolve({ data: [] as { id: string; scheduled_date: string | null; created_at: string }[] }),
  ]);

  const combined = [
    ...(posts ?? []).map((p) => ({ postId: p.id as string, storyId: null as string | null, scheduledDate: p.scheduled_date, createdAt: p.created_at })),
    ...(stories ?? []).map((s) => ({ postId: null as string | null, storyId: s.id as string, scheduledDate: s.scheduled_date, createdAt: s.created_at })),
  ].sort((a, b) => {
    if (a.scheduledDate !== b.scheduledDate) {
      if (!a.scheduledDate) return 1;
      if (!b.scheduledDate) return -1;
      return a.scheduledDate < b.scheduledDate ? -1 : 1;
    }
    return a.createdAt < b.createdAt ? -1 : 1;
  });

  const token = crypto.randomUUID();
  const { data: link, error: linkError } = await supabase
    .from("share_links")
    .insert({ project_id: projectId, token, title, created_by: user.id })
    .select("id")
    .single();

  if (linkError || !link) return { message: linkError?.message ?? "Couldn't create the share link." };

  const { error: itemsError } = await supabase.from("share_link_items").insert(
    combined.map((entry, index) => ({
      share_link_id: link.id,
      post_id: entry.postId,
      story_id: entry.storyId,
      position: index,
    })),
  );

  if (itemsError) {
    // Don't leave an empty, broken link behind if attaching its items failed.
    await supabase.from("share_links").delete().eq("id", link.id);
    return { message: itemsError.message };
  }

  revalidatePath(`/projects/${projectId}/share`);
  return { success: true, token };
}

export async function deleteShareLink(projectId: string, shareLinkId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("share_links").delete().eq("id", shareLinkId);
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${projectId}/share`);
}
