"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getPostComments, getStoryComments, type ItemCommentItem } from "@/lib/data/post-comments";
import { notifyMentions } from "@/lib/notifications";

// Internal team comments on a post/story -- mirrors addTaskComment/
// fetchTaskComments in actions/todo.ts. Mention-only notifications (see
// notifyMentions): this doesn't broadcast "someone commented" to the whole
// project, only pings whoever was actually @mentioned.
export async function addPostComment(
  projectId: string,
  postId: string,
  text: string,
): Promise<{ success: boolean; message?: string }> {
  const trimmed = text.trim();
  if (!trimmed) return { success: false, message: "Comment can't be empty." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "Not signed in." };

  const { error } = await supabase.from("post_comments").insert({
    post_id: postId,
    author_id: user.id,
    text: trimmed,
  });
  if (error) return { success: false, message: error.message };

  const { data: profile } = await supabase.from("profiles").select("name").eq("id", user.id).single();
  await notifyMentions(supabase, projectId, trimmed, {
    notifierName: profile?.name ?? "Someone",
    itemLabel: "a post",
    link: `/projects/${projectId}/posts/${postId}`,
    excludeUserId: user.id,
  });

  revalidatePath(`/projects/${projectId}/posts/${postId}`);
  return { success: true };
}

export async function fetchPostComments(postId: string): Promise<ItemCommentItem[]> {
  const supabase = await createClient();
  return getPostComments(supabase, postId);
}

export async function addStoryComment(
  projectId: string,
  storyId: string,
  text: string,
): Promise<{ success: boolean; message?: string }> {
  const trimmed = text.trim();
  if (!trimmed) return { success: false, message: "Comment can't be empty." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "Not signed in." };

  const { error } = await supabase.from("story_comments").insert({
    story_id: storyId,
    author_id: user.id,
    text: trimmed,
  });
  if (error) return { success: false, message: error.message };

  const { data: profile } = await supabase.from("profiles").select("name").eq("id", user.id).single();
  await notifyMentions(supabase, projectId, trimmed, {
    notifierName: profile?.name ?? "Someone",
    itemLabel: "a story",
    link: `/projects/${projectId}/stories/${storyId}`,
    excludeUserId: user.id,
  });

  revalidatePath(`/projects/${projectId}/stories/${storyId}`);
  return { success: true };
}

export async function fetchStoryComments(storyId: string): Promise<ItemCommentItem[]> {
  const supabase = await createClient();
  return getStoryComments(supabase, storyId);
}
