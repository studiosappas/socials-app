"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { canCreateReviewLinks, canDeleteReviewLink } from "@/lib/role-permissions";
import { SHARE_LINK_MESSAGES, friendlyShareLinkError } from "@/lib/review-link";
import type { ProjectRole } from "@/types/database";

export type CreateShareLinkState = { message?: string; success?: boolean; token?: string } | undefined;
export type DeleteShareLinkResult = { success: true } | { success: false; message: string };

// The Share menu lives on Grid and Content -- there is no /share page any
// more (see share-menu.tsx), so those two are what need a fresh link list.
function revalidateShareSurfaces(projectId: string) {
  revalidatePath(`/projects/${projectId}/grid`);
  revalidatePath(`/projects/${projectId}/stories`);
}

async function getProjectRole(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
  userId: string,
): Promise<ProjectRole | null> {
  const { data } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  return (data?.role as ProjectRole | undefined) ?? null;
}

// Authorization is enforced twice, deliberately: the role check here gives a
// clear, role-specific message before anything is written, and RLS
// (supabase/fix_member_share_review_links.sql) is what actually guarantees
// it -- a caller that skips this action still can't insert. Raw database
// errors are logged, never returned to the browser.
export async function createShareLink(
  projectId: string,
  _state: CreateShareLinkState,
  formData: FormData,
): Promise<CreateShareLinkState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { message: SHARE_LINK_MESSAGES.notLoggedIn };

  const role = await getProjectRole(supabase, projectId, user.id);
  if (!canCreateReviewLinks(role)) return { message: SHARE_LINK_MESSAGES.createNotAllowed };

  const title = String(formData.get("title") ?? "").trim();
  const postIds = Array.from(new Set(formData.getAll("post_ids").map(String)));
  const storyIds = Array.from(new Set(formData.getAll("story_ids").map(String)));
  if (postIds.length === 0 && storyIds.length === 0) {
    return { message: SHARE_LINK_MESSAGES.nothingSelected };
  }

  // Ordered by scheduled date (undated last), then created date -- gives
  // the client a sensible chronological read-through without needing a
  // manual reorder step. Scoped to THIS project: a link must never carry a
  // post/story from a different project, whatever ids were submitted.
  type Row = { id: string; scheduled_date: string | null; created_at: string };
  const [{ data: posts }, { data: stories }] = await Promise.all([
    postIds.length
      ? supabase.from("posts").select("id, scheduled_date, created_at").eq("project_id", projectId).in("id", postIds)
      : Promise.resolve({ data: [] as Row[] }),
    storyIds.length
      ? supabase.from("stories").select("id, scheduled_date, created_at").eq("project_id", projectId).in("id", storyIds)
      : Promise.resolve({ data: [] as Row[] }),
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

  // Nothing selected still exists in this project (deleted meanwhile, or
  // not this project's content) -- don't create an empty link.
  if (combined.length === 0) return { message: SHARE_LINK_MESSAGES.contentUnavailable };

  const token = crypto.randomUUID();
  const { data: link, error: linkError } = await supabase
    .from("share_links")
    .insert({ project_id: projectId, token, title, created_by: user.id })
    .select("id")
    .single();

  if (linkError || !link) {
    console.error("[share-links] create link failed", { projectId, role, code: linkError?.code, message: linkError?.message });
    return { message: friendlyShareLinkError(linkError, "create") };
  }

  const { error: itemsError } = await supabase.from("share_link_items").insert(
    combined.map((entry, index) => ({
      share_link_id: link.id,
      post_id: entry.postId,
      story_id: entry.storyId,
      position: index,
    })),
  );

  if (itemsError) {
    console.error("[share-links] attach items failed", { projectId, role, code: itemsError.code, message: itemsError.message });
    // Don't leave an empty, broken link behind if attaching its items failed.
    const { error: cleanupError } = await supabase.from("share_links").delete().eq("id", link.id);
    if (cleanupError) {
      console.error("[share-links] cleanup of empty link failed", { linkId: link.id, code: cleanupError.code, message: cleanupError.message });
    }
    return { message: friendlyShareLinkError(itemsError, "create") };
  }

  revalidateShareSurfaces(projectId);
  return { success: true, token };
}

// Returns a result instead of throwing: an RLS-blocked delete is NOT an
// error at the database level (it just matches zero rows), so the old
// "throw on error" version reported nothing at all when a delete silently
// did nothing. `.select("id")` on the delete is what makes "zero rows
// removed" visible.
export async function deleteShareLink(projectId: string, shareLinkId: string): Promise<DeleteShareLinkResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, message: SHARE_LINK_MESSAGES.notLoggedIn };

  const [role, { data: link }] = await Promise.all([
    getProjectRole(supabase, projectId, user.id),
    supabase.from("share_links").select("id, created_by").eq("id", shareLinkId).eq("project_id", projectId).maybeSingle(),
  ]);
  if (!link) {
    revalidateShareSurfaces(projectId);
    return { success: false, message: SHARE_LINK_MESSAGES.alreadyDeleted };
  }
  if (!canDeleteReviewLink(role, link.created_by === user.id)) {
    return { success: false, message: SHARE_LINK_MESSAGES.deleteNotAllowed };
  }

  const { data: deleted, error } = await supabase
    .from("share_links")
    .delete()
    .eq("id", shareLinkId)
    .eq("project_id", projectId)
    .select("id");

  if (error) {
    console.error("[share-links] delete failed", { projectId, role, code: error.code, message: error.message });
    return { success: false, message: friendlyShareLinkError(error, "delete") };
  }
  if (!deleted || deleted.length === 0) {
    // The role check above passed but the database removed nothing -- RLS
    // said no (e.g. the migration that lets a creator delete their own link
    // hasn't been applied yet).
    console.error("[share-links] delete removed no rows", { projectId, role, shareLinkId });
    return { success: false, message: SHARE_LINK_MESSAGES.deleteNotAllowed };
  }

  revalidateShareSurfaces(projectId);
  return { success: true };
}
