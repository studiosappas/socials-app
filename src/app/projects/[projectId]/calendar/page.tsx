import { addMonths, endOfMonth, format, startOfMonth, subMonths } from "date-fns";
import { createClient } from "@/lib/supabase/server";
import { CalendarBoard } from "./calendar-board";
import { buildCalendarCells, calendarGridRange, calendarThumbnailPath, type CalendarItem } from "@/lib/calendar-cells";
import { getProjectMemberOptions } from "@/lib/data/post-comments";
import { mergeWorkspaceSettings } from "@/lib/account-settings";
import { getCachedSignedUrls } from "@/lib/signed-url-cache";
import { canEditContent, hasPagePermission } from "@/lib/role-permissions";
import { AccessRestricted } from "../access-restricted";
import { effectivePostType } from "@/lib/post-type";
import type { MediaType } from "@/types/database";
import { getCalendarShareLinks } from "@/lib/data/calendar-share-links";
import { ShareCalendarButton } from "./share-calendar-button";

export default async function CalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const { projectId } = await params;
  const { month: monthParam } = await searchParams;

  const supabase = await createClient();

  // Automatic publish-marking: this app has no way to observe a post/story
  // actually going live on Instagram (no API integration), so "automatic"
  // is a date-based heuristic instead -- once scheduled_date has passed and
  // nothing already moved it off "scheduled," treat it as published. A
  // one-way push (mirrors completeAutoTaskForPost's convention in
  // task-automation.ts), run once per page load; manual override via the
  // post/story editor's own status field, or the calendar toggle below,
  // always still works in either direction afterward. Doesn't depend on
  // (and isn't depended on by) auth.getUser(), so both run in the same wave
  // -- the two UPDATEs still need to land before the status reads below.
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const [
    {
      data: { user },
    },
  ] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from("posts")
      .update({ status: "published" })
      .eq("project_id", projectId)
      .eq("status", "scheduled")
      .lte("scheduled_date", todayStr),
    supabase
      .from("stories")
      .update({ status: "published" })
      .eq("project_id", projectId)
      .eq("status", "scheduled")
      .lte("scheduled_date", todayStr),
  ]);

  const anchor = monthParam ? new Date(`${monthParam}-01T00:00:00`) : new Date();
  const monthStart = startOfMonth(anchor);
  const monthEnd = endOfMonth(anchor);
  const monthStartStr = format(monthStart, "yyyy-MM-dd");
  const monthEndStr = format(monthEnd, "yyyy-MM-dd");

  // profile/membership only need user.id (just resolved above); the four
  // post/story reads only need projectId and the month range (independent
  // of weekStartsOn -- month boundaries don't shift with which day a week
  // starts on) and the auto-publish UPDATEs above having landed. None of
  // these six depend on each other, so one wave covers all of them instead
  // of profile/membership blocking the post/story reads or vice versa.
  const [
    { data: profile },
    { data: membership },
    { data: scheduledPosts },
    { data: scheduledStories },
    { data: unscheduledPosts },
    { data: unscheduledStories },
  ] = await Promise.all([
    supabase.from("profiles").select("workspace_settings").eq("id", user!.id).single(),
    supabase
      .from("project_members")
      .select("role, custom_permissions")
      .eq("project_id", projectId)
      .eq("user_id", user!.id)
      .single(),
    supabase
      .from("posts")
      .select("id, post_type, scheduled_date, status")
      .eq("project_id", projectId)
      .gte("scheduled_date", monthStartStr)
      .lte("scheduled_date", monthEndStr),
    supabase
      .from("stories")
      .select("id, name, scheduled_date, status")
      .eq("project_id", projectId)
      .gte("scheduled_date", monthStartStr)
      .lte("scheduled_date", monthEndStr),
    supabase
      .from("posts")
      .select("id, post_type, scheduled_date, status")
      .eq("project_id", projectId)
      .is("scheduled_date", null),
    supabase
      .from("stories")
      .select("id, name, scheduled_date, status")
      .eq("project_id", projectId)
      .is("scheduled_date", null),
  ]);

  // Account > Workspace's Week Starts On + Preferences > Calendar's Show
  // Weekends -- fetched here (not just at Account) since this is the one
  // place they actually change anything.
  const { week_starts_on: weekStartsOn } = mergeWorkspaceSettings(profile?.workspace_settings);
  const { gridStartStr, gridEndStr } = calendarGridRange(anchor, weekStartsOn);

  if (!membership || !hasPagePermission(membership.role, membership.custom_permissions, "calendar")) {
    return <AccessRestricted />;
  }

  // Ordinary content-editing capability, not "genuinely privileged" -- see
  // grid/page.tsx's identical comment.
  const canManage = canEditContent(membership.role);
  // Share Calendar exposes the whole calendar, so it's owner/admin only
  // (same as calendar_share_links' RLS), not every content editor.
  const canShareCalendar = membership.role === "owner" || membership.role === "admin";

  const allPostIds = [
    ...(scheduledPosts ?? []).map((p) => p.id),
    ...(unscheduledPosts ?? []).map((p) => p.id),
  ];
  const allStoryIds = [
    ...(scheduledStories ?? []).map((s) => s.id),
    ...(unscheduledStories ?? []).map((s) => s.id),
  ];

  // calendarNotes (needs gridStartStr/gridEndStr, just derived above),
  // postAssets/storyFrames (need allPostIds/allStoryIds, just derived
  // above), and members are all independent of each other -- one wave.
  const [{ data: calendarNotes }, { data: postAssets }, { data: storyFrames }, members, calendarShare] = await Promise.all([
    supabase
      .from("calendar_notes")
      .select("date, body")
      .eq("project_id", projectId)
      .gte("date", gridStartStr)
      .lte("date", gridEndStr),
    allPostIds.length
      ? supabase
          .from("post_assets")
          .select("post_id, position, media_assets(storage_path, media_type, poster_storage_path)")
          .in("post_id", allPostIds)
          .order("position")
      : Promise.resolve({ data: [] }),
    allStoryIds.length
      ? supabase
          .from("story_frames")
          .select("story_id, position, media_assets(storage_path, media_type, poster_storage_path)")
          .in("story_id", allStoryIds)
          .order("position")
      : Promise.resolve({ data: [] }),
    getProjectMemberOptions(supabase, projectId),
    canShareCalendar ? getCalendarShareLinks(supabase, projectId) : null,
  ]);

  const noteByDate = new Map<string, string>();
  for (const note of calendarNotes ?? []) {
    noteByDate.set(note.date, note.body);
  }

  type ItemMedia = { storage_path: string; media_type: MediaType; poster_storage_path: string | null };
  const pathSet = new Set<string>();
  for (const row of [...(postAssets ?? []), ...(storyFrames ?? [])]) {
    const m = row.media_assets as ItemMedia | null;
    if (!m) continue;
    pathSet.add(m.storage_path);
    if (m.poster_storage_path) pathSet.add(m.poster_storage_path);
  }

  const urlByPath = await getCachedSignedUrls(supabase, "project-media", Array.from(pathSet));

  const thumbnailByPost = new Map<string, string | null>();
  const assetsByPost = new Map<string, string[]>();
  // Real media count per post (every item, signed URL or not) -- what
  // effectivePostType needs to show a 2+ item post as a Carousel even when
  // its stored post_type is an older "reel". Display only; nothing written.
  const itemCountByPost = new Map<string, number>();
  for (const a of postAssets ?? []) {
    if (a.media_assets) itemCountByPost.set(a.post_id, (itemCountByPost.get(a.post_id) ?? 0) + 1);
  }
  for (const a of postAssets ?? []) {
    const media = a.media_assets as ItemMedia | null;
    const url = media ? urlByPath.get(media.storage_path) ?? null : null;
    const thumbPath = media ? calendarThumbnailPath(media) : null;
    if (!thumbnailByPost.has(a.post_id)) thumbnailByPost.set(a.post_id, thumbPath ? urlByPath.get(thumbPath) ?? null : null);
    if (url) assetsByPost.set(a.post_id, [...(assetsByPost.get(a.post_id) ?? []), url]);
  }

  const thumbnailByStory = new Map<string, string | null>();
  const assetsByStory = new Map<string, string[]>();
  for (const f of storyFrames ?? []) {
    const media = f.media_assets as ItemMedia | null;
    const url = media ? urlByPath.get(media.storage_path) ?? null : null;
    const thumbPath = media ? calendarThumbnailPath(media) : null;
    if (!thumbnailByStory.has(f.story_id)) thumbnailByStory.set(f.story_id, thumbPath ? urlByPath.get(thumbPath) ?? null : null);
    if (url) assetsByStory.set(f.story_id, [...(assetsByStory.get(f.story_id) ?? []), url]);
  }

  // Posts before stories within a day -- buildCalendarCells keeps this order.
  const scheduledItems: { date: string; item: CalendarItem }[] = [];
  for (const post of scheduledPosts ?? []) {
    if (!post.scheduled_date) continue;
    scheduledItems.push({
      date: post.scheduled_date,
      item: {
        itemType: "post",
        itemId: post.id,
        label: effectivePostType(post.post_type, itemCountByPost.get(post.id) ?? 0),
        thumbnailUrl: thumbnailByPost.get(post.id) ?? null,
        assetUrls: assetsByPost.get(post.id) ?? [],
        href: `/projects/${projectId}/posts/${post.id}`,
        status: post.status,
      },
    });
  }
  for (const story of scheduledStories ?? []) {
    if (!story.scheduled_date) continue;
    scheduledItems.push({
      date: story.scheduled_date,
      item: {
        itemType: "story",
        itemId: story.id,
        label: story.name,
        thumbnailUrl: thumbnailByStory.get(story.id) ?? null,
        assetUrls: assetsByStory.get(story.id) ?? [],
        href: `/projects/${projectId}/stories/${story.id}`,
        status: story.status,
      },
    });
  }

  const cells = buildCalendarCells({
    anchor,
    weekStartsOn,
    todayStr: format(new Date(), "yyyy-MM-dd"),
    items: scheduledItems,
    noteByDate,
  });

  const unscheduled: CalendarItem[] = [
    ...(unscheduledPosts ?? []).map((p) => ({
      itemType: "post" as const,
      itemId: p.id,
      label: effectivePostType(p.post_type, itemCountByPost.get(p.id) ?? 0),
      thumbnailUrl: thumbnailByPost.get(p.id) ?? null,
      assetUrls: assetsByPost.get(p.id) ?? [],
      href: `/projects/${projectId}/posts/${p.id}`,
      status: p.status,
    })),
    ...(unscheduledStories ?? []).map((s) => ({
      itemType: "story" as const,
      itemId: s.id,
      label: s.name,
      thumbnailUrl: thumbnailByStory.get(s.id) ?? null,
      assetUrls: assetsByStory.get(s.id) ?? [],
      href: `/projects/${projectId}/stories/${s.id}`,
      status: s.status,
    })),
  ];

  return (
    <>
      {calendarShare && (
        <div className="mb-4 flex justify-end">
          <ShareCalendarButton projectId={projectId} links={calendarShare.links} tableMissing={calendarShare.tableMissing} />
        </div>
      )}
      <CalendarBoard
        projectId={projectId}
        monthLabel={format(anchor, "MMMM yyyy")}
        prevMonthParam={format(subMonths(anchor, 1), "yyyy-MM")}
        nextMonthParam={format(addMonths(anchor, 1), "yyyy-MM")}
        cells={cells}
        unscheduled={unscheduled}
        canManage={canManage}
        members={members}
        weekStartsOn={weekStartsOn}
      />
    </>
  );
}
