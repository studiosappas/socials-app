// Share Calendar's guest-side data rules, pure (no Supabase, no React, no
// runtime imports) so calendar-share-model.test.ts can run them directly.
// The security-relevant parts live here on purpose: what a token must look
// like before it reaches the database, which storage paths may be signed
// for a guest, and that only display fields ever reach the guest page.

import type { CalendarItem } from "@/lib/calendar-cells";
import type { MediaType, PostStatus, PostType, StoryStatus } from "@/types/database";

// 32 random bytes as base64url -- the same shape the migration's CHECK
// constraint and get_shared_calendar both enforce.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isCalendarShareToken(token: unknown): token is string {
  return typeof token === "string" && TOKEN_PATTERN.test(token);
}

// "?month=yyyy-MM" -> the 1st of that month (local time); anything else,
// including an out-of-range month, -> null (the caller uses this month).
export function parseShareMonthParam(month: unknown): Date | null {
  if (typeof month !== "string" || !/^\d{4}-\d{2}$/.test(month)) return null;
  const [year, monthIndex] = [Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1];
  if (year < 2000 || year > 2100 || monthIndex < 0 || monthIndex > 11) return null;
  return new Date(year, monthIndex, 1);
}

export type SharedCalendarRpcMedia = {
  mediaType: MediaType;
  storagePath: string;
  posterStoragePath: string | null;
};

// get_shared_calendar's response (supabase/add_calendar_share_links.sql,
// plus add_calendar_share_notes.sql's post/story `notes` -- absent until
// that runs, so optional).
export type SharedCalendarRpc = {
  projectId: string;
  projectName: string;
  weekStartsOn: number;
  posts: { id: string; date: string; postType: PostType; status: PostStatus; caption: string | null; notes?: string | null; media: SharedCalendarRpcMedia[] }[];
  stories: { id: string; date: string; status: StoryStatus; notes?: string | null; media: SharedCalendarRpcMedia[] }[];
  notes: { date: string; body: string }[];
};

export type GuestPreviewMedia = { url: string; posterUrl: string | null; mediaType: MediaType };
// Post-level, not per slide. Stories have no caption field, so theirs is
// always "". Notes are shared as written (approved), not filtered.
export type GuestPreview = { itemType: "post" | "story"; caption: string; notes: string; media: GuestPreviewMedia[] };

export function guestPreviewKey(item: Pick<CalendarItem, "itemType" | "itemId">): string {
  return `${item.itemType}:${item.itemId}`;
}

// Every path the guest page may sign -- only ones under this link's own
// project folder (every upload path is `${projectId}/...`). get_shared_calendar
// already scopes rows to the token's project; this is a second, independent
// check right before the service-role signer, so a bad row can never turn a
// guest link into a signer for another project's files.
export function sharedCalendarSignPaths(data: SharedCalendarRpc): string[] {
  const prefix = `${data.projectId}/`;
  const paths = new Set<string>();
  for (const entry of [...data.posts, ...data.stories]) {
    for (const m of entry.media) {
      for (const p of [m.storagePath, m.posterStoragePath]) {
        if (p && p.startsWith(prefix) && !p.includes("..")) paths.add(p);
      }
    }
  }
  return Array.from(paths);
}

// The calendar items (same CalendarItem shape the team Calendar builds, so
// CalendarView renders them identically) plus each item's preview payload.
// `href` is always empty: the guest Item slot never links anywhere.
// `thumbnailPath`/`postLabel` are calendar-cells.ts's calendarThumbnailPath
// and post-type.ts's effectivePostType, passed in to keep this file free of
// runtime imports.
export function buildSharedCalendarItems(
  data: SharedCalendarRpc,
  urlByPath: Map<string, string>,
  helpers: {
    thumbnailPath: (media: { storage_path: string; media_type: MediaType; poster_storage_path: string | null }) => string | null;
    postLabel: (stored: PostType, itemCount: number) => string;
  },
): {
  items: { date: string; item: CalendarItem }[];
  noteByDate: Map<string, string>;
  previews: Record<string, GuestPreview>;
} {
  const items: { date: string; item: CalendarItem }[] = [];
  const previews: Record<string, GuestPreview> = {};
  const signed = (path: string | null) => (path ? urlByPath.get(path) ?? null : null);

  function mediaOf(list: SharedCalendarRpcMedia[]) {
    const first = list[0];
    const thumbnailUrl = first
      ? signed(
          helpers.thumbnailPath({
            storage_path: first.storagePath,
            media_type: first.mediaType,
            poster_storage_path: first.posterStoragePath,
          }),
        )
      : null;
    const media: GuestPreviewMedia[] = [];
    for (const m of list) {
      const url = signed(m.storagePath);
      if (url) media.push({ url, posterUrl: signed(m.posterStoragePath), mediaType: m.mediaType });
    }
    return { thumbnailUrl, media };
  }

  // Posts before stories within a day -- same order as the team Calendar.
  for (const post of data.posts) {
    const { thumbnailUrl, media } = mediaOf(post.media);
    const item: CalendarItem = {
      itemType: "post",
      itemId: post.id,
      label: helpers.postLabel(post.postType, post.media.length),
      thumbnailUrl,
      assetUrls: [],
      href: "",
      status: post.status,
    };
    items.push({ date: post.date, item });
    previews[guestPreviewKey(item)] = { itemType: "post", caption: post.caption ?? "", notes: post.notes ?? "", media };
  }
  for (const story of data.stories) {
    const { thumbnailUrl, media } = mediaOf(story.media);
    const item: CalendarItem = {
      itemType: "story",
      itemId: story.id,
      label: "",
      thumbnailUrl,
      assetUrls: [],
      href: "",
      status: story.status,
    };
    items.push({ date: story.date, item });
    previews[guestPreviewKey(item)] = { itemType: "story", caption: "", notes: story.notes ?? "", media };
  }

  const noteByDate = new Map<string, string>();
  for (const note of data.notes) noteByDate.set(note.date, note.body);

  return { items, noteByDate, previews };
}
