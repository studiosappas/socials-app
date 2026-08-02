import Link from "next/link";
import { endOfWeek, format, startOfWeek, subMonths } from "date-fns";
import { createClient } from "@/lib/supabase/server";

const SIGNED_URL_TTL_SECONDS = 3600;
const MONTHLY_OVERVIEW_MONTHS = 6;

export default async function ProjectOverviewPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const supabase = await createClient();

  const weekStart = format(startOfWeek(new Date()), "yyyy-MM-dd");
  const weekEnd = format(endOfWeek(new Date()), "yyyy-MM-dd");
  const overviewStart = format(startOfWeek(subMonths(new Date(), MONTHLY_OVERVIEW_MONTHS - 1)), "yyyy-MM-dd");

  const [
    { data: project },
    { count: postsThisWeek },
    { count: storiesThisWeek },
    { count: draftCount },
    { count: scheduledCount },
    { count: publishedCount },
    { count: totalPostsCount },
    { count: totalStoriesCount },
    { data: monthlyPosts },
    { data: monthlyStories },
  ] = await Promise.all([
    supabase.from("projects").select("name, ig_display_name").eq("id", projectId).single(),
    supabase
      .from("posts")
      .select("*", { count: "exact", head: true })
      .eq("project_id", projectId)
      .gte("scheduled_date", weekStart)
      .lte("scheduled_date", weekEnd),
    supabase
      .from("stories")
      .select("*", { count: "exact", head: true })
      .eq("project_id", projectId)
      .gte("scheduled_date", weekStart)
      .lte("scheduled_date", weekEnd),
    supabase
      .from("posts")
      .select("*", { count: "exact", head: true })
      .eq("project_id", projectId)
      .eq("status", "draft"),
    supabase
      .from("posts")
      .select("*", { count: "exact", head: true })
      .eq("project_id", projectId)
      .eq("status", "scheduled"),
    supabase
      .from("posts")
      .select("*", { count: "exact", head: true })
      .eq("project_id", projectId)
      .eq("status", "published"),
    supabase.from("posts").select("*", { count: "exact", head: true }).eq("project_id", projectId),
    supabase.from("stories").select("*", { count: "exact", head: true }).eq("project_id", projectId),
    supabase
      .from("posts")
      .select("scheduled_date")
      .eq("project_id", projectId)
      .gte("scheduled_date", overviewStart),
    supabase
      .from("stories")
      .select("scheduled_date")
      .eq("project_id", projectId)
      .gte("scheduled_date", overviewStart),
  ]);

  const monthlyOverview: { month: string; posts: number; stories: number }[] = [];
  for (let i = MONTHLY_OVERVIEW_MONTHS - 1; i >= 0; i--) {
    const monthDate = subMonths(new Date(), i);
    const monthKey = format(monthDate, "yyyy-MM");
    const posts = (monthlyPosts ?? []).filter(
      (p) => p.scheduled_date && p.scheduled_date.startsWith(monthKey),
    ).length;
    const stories = (monthlyStories ?? []).filter(
      (s) => s.scheduled_date && s.scheduled_date.startsWith(monthKey),
    ).length;
    monthlyOverview.push({ month: format(monthDate, "MMMM yyyy"), posts, stories });
  }

  const { data: rows } = await supabase
    .from("grid_rows")
    .select("id, position")
    .eq("project_id", projectId)
    .order("position")
    .limit(2);

  const rowIds = (rows ?? []).map((r) => r.id);

  const { data: slots } = rowIds.length
    ? await supabase
        .from("grid_slots")
        .select("id, row_id, position, post_id")
        .in("row_id", rowIds)
        .order("position")
    : { data: [] };

  const postIds = (slots ?? [])
    .map((s) => s.post_id)
    .filter((id): id is string => Boolean(id));

  const { data: postAssets } = postIds.length
    ? await supabase
        .from("post_assets")
        .select("post_id, position, media_assets(storage_path)")
        .in("post_id", postIds)
        .order("position")
    : { data: [] };

  const pathSet = new Set<string>();
  for (const a of postAssets ?? []) {
    const p = (a.media_assets as { storage_path: string } | null)?.storage_path;
    if (p) pathSet.add(p);
  }

  const pathList = Array.from(pathSet);
  const { data: signedUrls } = pathList.length
    ? await supabase.storage.from("project-media").createSignedUrls(pathList, SIGNED_URL_TTL_SECONDS)
    : { data: [] };

  const urlByPath = new Map<string, string>();
  for (const entry of signedUrls ?? []) {
    if (entry.signedUrl && entry.path) urlByPath.set(entry.path, entry.signedUrl);
  }

  const thumbnailByPost = new Map<string, string | null>();
  for (const a of postAssets ?? []) {
    if (thumbnailByPost.has(a.post_id)) continue;
    const path = (a.media_assets as { storage_path: string } | null)?.storage_path;
    thumbnailByPost.set(a.post_id, path ? urlByPath.get(path) ?? null : null);
  }

  const feedThumbnails = (slots ?? [])
    .filter((s) => s.post_id)
    .slice(0, 6)
    .map((s) => thumbnailByPost.get(s.post_id!) ?? null);

  const brandName = project?.ig_display_name || project?.name || "";

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <p className="text-xs tracking-wide text-muted uppercase">Brand</p>
        <h1 className="text-2xl font-light">{brandName}</h1>
      </div>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <StatTile label="Posts" value={totalPostsCount ?? 0} />
        <StatTile label="Stories" value={totalStoriesCount ?? 0} />
        <StatTile label="Posts this week" value={postsThisWeek ?? 0} />
        <StatTile label="Stories this week" value={storiesThisWeek ?? 0} />
        <StatTile label="Draft" value={draftCount ?? 0} />
        <StatTile label="Scheduled" value={scheduledCount ?? 0} />
        <StatTile label="Published" value={publishedCount ?? 0} />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Monthly publishing overview</h2>
        <table className="w-full max-w-md text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs tracking-wide text-muted uppercase">
              <th className="py-2 font-normal">Month</th>
              <th className="py-2 font-normal">Posts</th>
              <th className="py-2 font-normal">Stories</th>
            </tr>
          </thead>
          <tbody>
            {monthlyOverview.map((row) => (
              <tr key={row.month} className="border-b border-border">
                <td className="py-2">{row.month}</td>
                <td className="py-2">{row.posts}</td>
                <td className="py-2">{row.stories}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Recent feed</h2>
          <Link
            href={`/projects/${projectId}/grid`}
            className="text-xs text-muted hover:underline"
          >
            Open grid →
          </Link>
        </div>
        <div className="grid max-w-xs grid-cols-3 gap-1">
          {feedThumbnails.map((url, i) => (
            <div
              key={i}
              className="aspect-[4/5] overflow-hidden rounded border border-border bg-black/[.02]"
            >
              {url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={url} alt="" className="h-full w-full object-cover" />
              )}
            </div>
          ))}
          {feedThumbnails.length === 0 && (
            <p className="col-span-3 text-xs text-muted">
              No posts in the grid yet.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border p-3">
      <span className="text-2xl font-semibold">{value}</span>
      <span className="text-xs text-muted">{label}</span>
    </div>
  );
}
