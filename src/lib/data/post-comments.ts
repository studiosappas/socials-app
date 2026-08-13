import { createClient } from "@/lib/supabase/server";

export type ItemCommentItem = {
  id: string;
  itemId: string;
  authorId: string;
  authorName: string;
  authorAvatarUrl: string | null;
  text: string;
  createdAt: string;
};

// Same query shape as getTaskComments in data/tasks.ts, against the
// post_comments/story_comments tables -- built for the original Client
// Review Mode, unused since that was reworked into token-based Notes sync,
// repurposed here as internal team comments (see task-detail.tsx for the
// UI this mirrors).
export async function getPostComments(
  supabase: Awaited<ReturnType<typeof createClient>>,
  postId: string,
): Promise<ItemCommentItem[]> {
  const { data } = await supabase
    .from("post_comments")
    .select("id, post_id, author_id, text, created_at, profiles(name, avatar_url)")
    .eq("post_id", postId)
    .order("created_at", { ascending: true });

  return (data ?? []).map((c) => {
    const profile = c.profiles as { name: string | null; avatar_url: string | null } | null;
    return {
      id: c.id,
      itemId: c.post_id,
      authorId: c.author_id,
      authorName: profile?.name ?? "Unknown",
      authorAvatarUrl: profile?.avatar_url ?? null,
      text: c.text,
      createdAt: c.created_at,
    };
  });
}

export async function getStoryComments(
  supabase: Awaited<ReturnType<typeof createClient>>,
  storyId: string,
): Promise<ItemCommentItem[]> {
  const { data } = await supabase
    .from("story_comments")
    .select("id, story_id, author_id, text, created_at, profiles(name, avatar_url)")
    .eq("story_id", storyId)
    .order("created_at", { ascending: true });

  return (data ?? []).map((c) => {
    const profile = c.profiles as { name: string | null; avatar_url: string | null } | null;
    return {
      id: c.id,
      itemId: c.story_id,
      authorId: c.author_id,
      authorName: profile?.name ?? "Unknown",
      authorAvatarUrl: profile?.avatar_url ?? null,
      text: c.text,
      createdAt: c.created_at,
    };
  });
}

export type ProjectMemberOption = { id: string; name: string };

// Shared by every MentionField call site that needs the real project
// member list to autocomplete/resolve @mentions against (post/story
// comments, task comments, calendar notes).
export async function getProjectMemberOptions(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
): Promise<ProjectMemberOption[]> {
  const { data } = await supabase
    .from("project_members")
    .select("user_id, profiles(name)")
    .eq("project_id", projectId);

  return (data ?? []).map((m) => ({
    id: m.user_id as string,
    name: (m.profiles as { name: string | null } | null)?.name ?? "Unknown",
  }));
}
