import { createClient } from "@/lib/supabase/server";
import { getShareLinksData } from "@/lib/data/share-links";
import { StoriesBoard } from "./stories-board";

const SIGNED_URL_TTL_SECONDS = 3600;

export default async function StoriesPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: membership } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", user!.id)
    .single();

  const canManage = membership?.role === "owner" || membership?.role === "admin";

  const { data: stories } = await supabase
    .from("stories")
    .select("id, name, scheduled_date, notes, position")
    .eq("project_id", projectId)
    .order("position");

  const storyIds = (stories ?? []).map((s) => s.id);

  const { data: frames } = storyIds.length
    ? await supabase
        .from("story_frames")
        .select("id, story_id, position, media_assets(storage_path)")
        .in("story_id", storyIds)
        .order("position")
    : { data: [] };

  const pathList = Array.from(
    new Set(
      (frames ?? [])
        .map((f) => (f.media_assets as { storage_path: string } | null)?.storage_path)
        .filter((p): p is string => Boolean(p)),
    ),
  );

  const { data: signedUrls } = pathList.length
    ? await supabase.storage.from("project-media").createSignedUrls(pathList, SIGNED_URL_TTL_SECONDS)
    : { data: [] };

  const urlByPath = new Map<string, string>();
  for (const entry of signedUrls ?? []) {
    if (entry.signedUrl && entry.path) urlByPath.set(entry.path, entry.signedUrl);
  }

  const framesByStory = new Map<string, { thumbnailUrl: string | null; count: number }>();
  for (const frame of frames ?? []) {
    const path = (frame.media_assets as { storage_path: string } | null)?.storage_path;
    const existing = framesByStory.get(frame.story_id);
    if (!existing) {
      framesByStory.set(frame.story_id, {
        thumbnailUrl: path ? urlByPath.get(path) ?? null : null,
        count: 1,
      });
    } else {
      existing.count += 1;
    }
  }

  const storyItems = (stories ?? []).map((story) => ({
    id: story.id,
    name: story.name,
    scheduledDate: story.scheduled_date,
    notes: story.notes,
    thumbnailUrl: framesByStory.get(story.id)?.thumbnailUrl ?? null,
  }));

  const shareData = await getShareLinksData(supabase, projectId);

  return (
    <StoriesBoard
      projectId={projectId}
      stories={storyItems}
      canManage={canManage}
      shareLinks={shareData.links}
      shareTableMissing={shareData.tableMissing}
    />
  );
}
