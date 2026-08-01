import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createStory } from "@/lib/actions/stories";

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
    .select("id, name, scheduled_date, position")
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Stories</h2>
        {canManage && (
          <form action={createStory.bind(null, projectId)}>
            <button
              type="submit"
              className="rounded-md bg-foreground px-3 py-1.5 text-xs text-background"
            >
              + New story
            </button>
          </form>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {(stories ?? []).map((story) => {
          const info = framesByStory.get(story.id);
          return (
            <Link
              key={story.id}
              href={`/projects/${projectId}/stories/${story.id}`}
              className="flex flex-col gap-1"
            >
              <div className="relative aspect-[9/16] overflow-hidden rounded-md border border-border bg-black/[.02]">
                {info?.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={info.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="absolute inset-0 flex items-center justify-center text-xs text-muted">
                    No frames
                  </span>
                )}
              </div>
              <p className="truncate text-xs">{story.name}</p>
              <p className="text-[11px] text-muted">
                {info?.count ?? 0} frame{(info?.count ?? 0) === 1 ? "" : "s"}
              </p>
            </Link>
          );
        })}
        {(stories ?? []).length === 0 && (
          <p className="col-span-full text-sm text-muted">
            No stories yet — create one above.
          </p>
        )}
      </div>
    </div>
  );
}
