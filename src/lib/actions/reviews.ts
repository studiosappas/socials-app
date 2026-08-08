"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { notifyProjectMembers } from "@/lib/notifications";
import { getPostComments, getStoryComments, type ReviewCommentItem } from "@/lib/data/review";
import type { CalendarItemType } from "@/lib/actions/calendar";

export async function fetchReviewComments(itemType: CalendarItemType, itemId: string): Promise<ReviewCommentItem[]> {
  return itemType === "post" ? getPostComments(itemId) : getStoryComments(itemId);
}

export async function addReviewComment(
  projectId: string,
  itemType: CalendarItemType,
  itemId: string,
  text: string,
): Promise<{ success: boolean; message?: string }> {
  const trimmed = text.trim();
  if (!trimmed) return { success: false, message: "Comment can't be empty." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "Not signed in." };

  const { error } =
    itemType === "post"
      ? await supabase.from("post_comments").insert({ post_id: itemId, author_id: user.id, text: trimmed })
      : await supabase.from("story_comments").insert({ story_id: itemId, author_id: user.id, text: trimmed });
  if (error) return { success: false, message: error.message };

  const { data: commenter } = await supabase.from("profiles").select("name").eq("id", user.id).single();
  await notifyProjectMembers(
    supabase,
    projectId,
    "review_comment",
    {
      title: `${commenter?.name ?? "Someone"} commented on a ${itemType} in review`,
      icon: "💬",
      link: `/projects/${projectId}/review`,
    },
    { excludeUserId: user.id },
  );

  revalidatePath(`/projects/${projectId}/review`);
  return { success: true };
}

// Client Reviewer's approve/request-changes -- routed through the
// SECURITY DEFINER set_{post,story}_review_status RPCs (see schema.sql):
// RLS can't restrict an UPDATE to only the review_status column, so the RPC
// does its own role check and is the only write surface for this field.
export async function setReviewStatus(
  projectId: string,
  itemType: CalendarItemType,
  itemId: string,
  status: "approved" | "changes_requested",
): Promise<{ success: boolean; message?: string }> {
  const supabase = await createClient();
  const { error } =
    itemType === "post"
      ? await supabase.rpc("set_post_review_status", { p_post_id: itemId, p_status: status })
      : await supabase.rpc("set_story_review_status", { p_story_id: itemId, p_status: status });
  if (error) return { success: false, message: error.message };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  await notifyProjectMembers(
    supabase,
    projectId,
    "approval_requested",
    {
      title: status === "approved" ? "A client approved a post" : "A client requested changes",
      icon: status === "approved" ? "✅" : "🔄",
      link: `/projects/${projectId}/review`,
    },
    { excludeUserId: user?.id },
  );

  revalidatePath(`/projects/${projectId}/review`);
  revalidatePath(`/projects/${projectId}/grid`);
  revalidatePath(`/projects/${projectId}/calendar`);
  return { success: true };
}

// Owner/admin resetting a mis-click back to pending -- a plain update,
// already covered by their existing "Admins manage posts/stories" RLS
// policy (project_role in ('owner','admin')), unlike the client-only RPC
// above.
export async function resetReviewStatus(projectId: string, itemType: CalendarItemType, itemId: string) {
  const supabase = await createClient();
  const table = itemType === "post" ? "posts" : "stories";
  const { error } = await supabase.from(table).update({ review_status: "pending" }).eq("id", itemId);
  if (error) throw new Error(error.message);

  revalidatePath(`/projects/${projectId}/review`);
  revalidatePath(`/projects/${projectId}/grid`);
  revalidatePath(`/projects/${projectId}/calendar`);
}
