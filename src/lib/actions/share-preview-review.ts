"use server";

import { createClient } from "@/lib/supabase/server";
import { notifyProjectMembers } from "@/lib/notifications";
import { parseMentions } from "@/lib/mentions";
import type { ReviewNotifyContext, ReviewStatus } from "@/types/database";

type ItemType = "post" | "story";
type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// Best-effort, same reasoning as notifyProjectMembers itself -- a client's
// review submission should never fail because the notification side of it
// hit a snag. Reuses the "review_comment" event key that's been defined in
// notification-events.ts since the original Client Review Mode build, never
// wired up until now.
async function notifyManagerOfFeedback(
  supabase: SupabaseServerClient,
  token: string,
  itemType: ItemType,
  itemId: string,
  text?: string,
): Promise<void> {
  try {
    const { data } = await supabase.rpc("get_review_notify_context_by_token", {
      p_token: token,
      p_post_id: itemType === "post" ? itemId : null,
      p_story_id: itemType === "story" ? itemId : null,
    });
    const context = data as ReviewNotifyContext | null;
    if (!context) return;

    const link = `/projects/${context.projectId}/${itemType === "post" ? "posts" : "stories"}/${itemId}`;

    // Broadcast to the whole project -- every account with access to this
    // review link's project sees that activity happened, same as any other
    // notifyProjectMembers call.
    await notifyProjectMembers(supabase, context.projectId, "review_comment", {
      title: context.title ? `Client left feedback on "${context.title}"` : "Client left feedback on a post",
      icon: "💬",
      link,
    });

    // On top of the broadcast above -- an explicit @mention in the client's
    // notes also pings that specific person directly, the same signal an
    // internal @mention gives (see notifyMentions), using the member list
    // get_review_notify_context_by_token hands back since an anonymous
    // reviewer's own session can't query project_members itself.
    if (text) {
      const mentionedIds = parseMentions(text, context.members ?? []);
      if (mentionedIds.length > 0) {
        await notifyProjectMembers(
          supabase,
          context.projectId,
          "mentioned",
          {
            title: `A client mentioned you${context.title ? ` in "${context.title}"` : ""}`,
            icon: "🔔",
            link,
          },
          { onlyUserIds: mentionedIds },
        );
      }
    }
  } catch {
    // Best-effort.
  }
}

// No login, no revalidatePath -- there's no authenticated session/cached
// page to revalidate for an anonymous review-link visitor. Each of these
// just calls the matching SECURITY DEFINER *_by_token RPC (see schema.sql),
// which does its own token-reachability check before writing -- the same
// pattern get_shared_preview already uses for anonymous reads, extended to
// writes.
export async function submitReviewStatus(
  token: string,
  itemType: ItemType,
  itemId: string,
  status: ReviewStatus,
): Promise<{ success: boolean; message?: string }> {
  const supabase = await createClient();
  const { error } =
    itemType === "post"
      ? await supabase.rpc("set_post_review_status_by_token", { p_token: token, p_post_id: itemId, p_status: status })
      : await supabase.rpc("set_story_review_status_by_token", { p_token: token, p_story_id: itemId, p_status: status });
  if (error) return { success: false, message: error.message };
  await notifyManagerOfFeedback(supabase, token, itemType, itemId);
  return { success: true };
}

export async function submitReviewNotes(
  token: string,
  itemType: ItemType,
  itemId: string,
  notes: string,
): Promise<{ success: boolean; message?: string }> {
  const supabase = await createClient();
  const { error } =
    itemType === "post"
      ? await supabase.rpc("set_post_notes_by_token", { p_token: token, p_post_id: itemId, p_notes: notes })
      : await supabase.rpc("set_story_notes_by_token", { p_token: token, p_story_id: itemId, p_notes: notes });
  if (error) return { success: false, message: error.message };
  await notifyManagerOfFeedback(supabase, token, itemType, itemId, notes);
  return { success: true };
}
