import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { createClient } from "@/lib/supabase/server";
import { CalendarBoard, type CalendarCell, type CalendarItem } from "./calendar-board";
import { getProjectMemberOptions } from "@/lib/data/post-comments";
import { mergeWorkspaceSettings } from "@/lib/account-settings";
import { getCachedSignedUrls } from "@/lib/signed-url-cache";
import { hasPagePermission } from "@/lib/role-permissions";
import { AccessRestricted } from "../access-restricted";

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
  const gridStart = startOfWeek(monthStart, { weekStartsOn });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn });
  const gridStartStr = format(gridStart, "yyyy-MM-dd");
  const gridEndStr = format(gridEnd, "yyyy-MM-dd");

  if (!membership || !hasPagePermission(membership.role, membership.custom_permissions, "calendar")) {
    return <AccessRestricted />;
  }

  const canManage = membership.role === "owner" || membership.role === "admin";

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
  const [{ data: calendarNotes }, { data: postAssets }, { data: storyFrames }, members] = await Promise.all([
    supabase
      .from("calendar_notes")
      .select("date, body")
      .eq("project_id", projectId)
      .gte("date", gridStartStr)
      .lte("date", gridEndStr),
    allPostIds.length
      ? supabase
          .from("post_assets")
          .select("post_id, position, media_assets(storage_path)")
          .in("post_id", allPostIds)
          .order("position")
      : Promise.resolve({ data: [] }),
    allStoryIds.length
      ? supabase
          .from("story_frames")
          .select("story_id, position, media_assets(storage_path)")
          .in("story_id", allStoryIds)
          .order("position")
      : Promise.resolve({ data: [] }),
    getProjectMemberOptions(supabase, projectId),
  ]);

  const noteByDate = new Map<string, string>();
  for (const note of calendarNotes ?? []) {
    noteByDate.set(note.date, note.body);
  }

  const pathSet = new Set<string>();
  for (const a of postAssets ?? []) {
    const p = (a.media_assets as { storage_path: string } | null)?.storage_path;
    if (p) pathSet.add(p);
  }
  for (const f of storyFrames ?? []) {
    const p = (f.media_assets as { storage_path: string } | null)?.storage_path;
    if (p) pathSet.add(p);
  }

  const urlByPath = await getCachedSignedUrls(supabase, "project-media", Array.from(pathSet));

  const thumbnailByPost = new Map<string, string | null>();
  const assetsByPost = new Map<string, string[]>();
  for (const a of postAssets ?? []) {
    const path = (a.media_assets as { storage_path: string } | null)?.storage_path;
    const url = path ? urlByPath.get(path) ?? null : null;
    if (!thumbnailByPost.has(a.post_id)) thumbnailByPost.set(a.post_id, url);
    if (url) assetsByPost.set(a.post_id, [...(assetsByPost.get(a.post_id) ?? []), url]);
  }

  const thumbnailByStory = new Map<string, string | null>();
  const assetsByStory = new Map<string, string[]>();
  for (const f of storyFrames ?? []) {
    const path = (f.media_assets as { storage_path: string } | null)?.storage_path;
    const url = path ? urlByPath.get(path) ?? null : null;
    if (!thumbnailByStory.has(f.story_id)) thumbnailByStory.set(f.story_id, url);
    if (url) assetsByStory.set(f.story_id, [...(assetsByStory.get(f.story_id) ?? []), url]);
  }

  const itemsByDate = new Map<string, CalendarItem[]>();
  for (const post of scheduledPosts ?? []) {
    if (!post.scheduled_date) continue;
    const list = itemsByDate.get(post.scheduled_date) ?? [];
    list.push({
      itemType: "post",
      itemId: post.id,
      label: post.post_type,
      thumbnailUrl: thumbnailByPost.get(post.id) ?? null,
      assetUrls: assetsByPost.get(post.id) ?? [],
      href: `/projects/${projectId}/posts/${post.id}`,
      status: post.status,
    });
    itemsByDate.set(post.scheduled_date, list);
  }
  for (const story of scheduledStories ?? []) {
    if (!story.scheduled_date) continue;
    const list = itemsByDate.get(story.scheduled_date) ?? [];
    list.push({
      itemType: "story",
      itemId: story.id,
      label: story.name,
      thumbnailUrl: thumbnailByStory.get(story.id) ?? null,
      assetUrls: assetsByStory.get(story.id) ?? [],
      href: `/projects/${projectId}/stories/${story.id}`,
      status: story.status,
    });
    itemsByDate.set(story.scheduled_date, list);
  }

  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
  const cells: CalendarCell[] = days.map((day) => {
    const dateStr = format(day, "yyyy-MM-dd");
    return {
      date: dateStr,
      dayNumber: day.getDate(),
      isCurrentMonth: day.getMonth() === anchor.getMonth(),
      isToday: dateStr === format(new Date(), "yyyy-MM-dd"),
      items: itemsByDate.get(dateStr) ?? [],
      note: noteByDate.get(dateStr) ?? null,
    };
  });

  const unscheduled: CalendarItem[] = [
    ...(unscheduledPosts ?? []).map((p) => ({
      itemType: "post" as const,
      itemId: p.id,
      label: p.post_type,
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
  );
}
