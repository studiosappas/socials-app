// Share Calendar security + regression tests -- pure, no Supabase/React.
// Run with:
//   node --experimental-strip-types src/lib/calendar-share-model.test.ts

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  buildSharedCalendarItems,
  guestPreviewKey,
  isCalendarShareToken,
  parseShareMonthParam,
  sharedCalendarSignPaths,
  type SharedCalendarRpc,
} from "./calendar-share-model.ts";
import { calendarThumbnailPath } from "./calendar-cells.ts";
import { effectivePostType } from "./post-type.ts";

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    throw err;
  }
}

const P = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const helpers = { thumbnailPath: calendarThumbnailPath, postLabel: effectivePostType };

function rpc(): SharedCalendarRpc {
  return {
    projectId: P,
    projectName: "Acme",
    weekStartsOn: 1,
    posts: [
      {
        id: "p-video",
        date: "2026-11-03",
        postType: "reel",
        status: "draft",
        caption: "Launch reel",
        media: [{ mediaType: "video", storagePath: `${P}/v.mp4`, posterStoragePath: `${P}/v-poster.jpg` }],
      },
      {
        id: "p-carousel",
        date: "2026-11-03",
        postType: "post",
        status: "scheduled",
        caption: null,
        media: [
          { mediaType: "image", storagePath: `${P}/a.jpg`, posterStoragePath: null },
          { mediaType: "image", storagePath: `${P}/b.jpg`, posterStoragePath: null },
        ],
      },
      {
        id: "p-noposter",
        date: "2026-11-04",
        postType: "reel",
        status: "draft",
        caption: "",
        media: [{ mediaType: "video", storagePath: `${P}/n.mp4`, posterStoragePath: null }],
      },
    ],
    stories: [
      {
        id: "s1",
        date: "2026-11-03",
        status: "published",
        media: [{ mediaType: "image", storagePath: `${P}/s.jpg`, posterStoragePath: null }],
      },
    ],
    notes: [{ date: "2026-11-05", body: "Shoot day" }],
  };
}

const signAll = (paths: string[]) => new Map(paths.map((p) => [p, `https://signed/${p}`]));

// ---------- token ----------

test("server-generated tokens (32 random bytes, base64url) are accepted", () => {
  for (let i = 0; i < 50; i++) assert.ok(isCalendarShareToken(randomBytes(32).toString("base64url")));
});

test("anything else is rejected before reaching the database", () => {
  const bad: unknown[] = [
    "",
    crypto.randomUUID(), // a share_links (review link) token must not open a calendar
    "a".repeat(42),
    "a".repeat(44),
    `${"a".repeat(42)}/`,
    `${"a".repeat(40)}' --`,
    `${"a".repeat(42)}=`,
    "../../etc/passwd",
    null,
    undefined,
    42,
    ["a".repeat(43)],
  ];
  for (const t of bad) assert.equal(isCalendarShareToken(t), false, String(t));
});

// ---------- month ----------

test("month param: valid yyyy-MM only, otherwise null", () => {
  assert.deepEqual(parseShareMonthParam("2026-11"), new Date(2026, 10, 1));
  for (const m of [undefined, "", "2026-13", "2026-00", "2026-1", "26-11", "2026-11-01", "1900-01", "2026-11;drop", ["2026-11"]]) {
    assert.equal(parseShareMonthParam(m), null, String(m));
  }
});

// ---------- signing scope ----------

test("only this project's paths (media + posters) are ever signed", () => {
  const data = rpc();
  data.posts[0].media.push({ mediaType: "image", storagePath: `${OTHER}/leak.jpg`, posterStoragePath: `${OTHER}/leak-poster.jpg` });
  data.stories[0].media.push({ mediaType: "image", storagePath: `${P}/../${OTHER}/x.jpg`, posterStoragePath: null });
  data.stories[0].media.push({ mediaType: "image", storagePath: `${P}`, posterStoragePath: null });
  const paths = sharedCalendarSignPaths(data);
  assert.ok(paths.includes(`${P}/v.mp4`));
  assert.ok(paths.includes(`${P}/v-poster.jpg`));
  for (const p of paths) {
    assert.ok(p.startsWith(`${P}/`), p);
    assert.ok(!p.includes(".."), p);
  }
  assert.equal(new Set(paths).size, paths.length, "deduplicated");
});

test("an unsigned (out-of-scope) path never reaches the guest", () => {
  const data = rpc();
  data.posts[0].media = [{ mediaType: "image", storagePath: `${OTHER}/leak.jpg`, posterStoragePath: null }];
  const { items, previews } = buildSharedCalendarItems(data, signAll(sharedCalendarSignPaths(data)), helpers);
  const leaked = items.find((i) => i.item.itemId === "p-video")!;
  assert.equal(leaked.item.thumbnailUrl, null);
  assert.deepEqual(previews["post:p-video"].media, []);
  assert.ok(!JSON.stringify({ items, previews }).includes(OTHER));
});

// ---------- display data ----------

test("items match the team Calendar's shape, never link into the app, and carry no extra fields", () => {
  const { items } = buildSharedCalendarItems(rpc(), signAll(sharedCalendarSignPaths(rpc())), helpers);
  for (const { item } of items) {
    assert.deepEqual(Object.keys(item).sort(), ["assetUrls", "href", "itemId", "itemType", "label", "status", "thumbnailUrl"]);
    assert.equal(item.href, "");
    assert.deepEqual(item.assetUrls, []);
  }
});

test("posts before stories, drafts included, carousel label from media count", () => {
  const { items } = buildSharedCalendarItems(rpc(), signAll(sharedCalendarSignPaths(rpc())), helpers);
  assert.deepEqual(
    items.map((i) => `${i.item.itemType}:${i.item.itemId}`),
    ["post:p-video", "post:p-carousel", "post:p-noposter", "story:s1"],
  );
  assert.equal(items[0].item.status, "draft");
  assert.equal(items[1].item.label, "carousel");
  assert.equal(items[0].item.label, "reel");
  assert.equal(items[3].item.label, "", "story names are not exposed");
});

test("video chip uses its poster; no poster -> icon fallback; images keep the original", () => {
  const { items } = buildSharedCalendarItems(rpc(), signAll(sharedCalendarSignPaths(rpc())), helpers);
  const byId = new Map(items.map((i) => [i.item.itemId, i.item]));
  assert.equal(byId.get("p-video")!.thumbnailUrl, `https://signed/${P}/v-poster.jpg`);
  assert.equal(byId.get("p-noposter")!.thumbnailUrl, null);
  assert.equal(byId.get("p-carousel")!.thumbnailUrl, `https://signed/${P}/a.jpg`);
});

test("previews: caption for posts, none for stories, every signed media item in order", () => {
  const { items, previews, noteByDate } = buildSharedCalendarItems(rpc(), signAll(sharedCalendarSignPaths(rpc())), helpers);
  assert.equal(Object.keys(previews).length, items.length);
  assert.deepEqual(previews["post:p-video"], {
    itemType: "post",
    caption: "Launch reel",
    media: [{ url: `https://signed/${P}/v.mp4`, posterUrl: `https://signed/${P}/v-poster.jpg`, mediaType: "video" }],
  });
  assert.equal(previews["post:p-carousel"].caption, "");
  assert.deepEqual(
    previews["post:p-carousel"].media.map((m) => m.url),
    [`https://signed/${P}/a.jpg`, `https://signed/${P}/b.jpg`],
  );
  assert.equal(previews["story:s1"].caption, "");
  assert.equal(guestPreviewKey(items[3].item), "story:s1");
  assert.equal(noteByDate.get("2026-11-05"), "Shoot day");
});

test("signing failure (no URLs at all) still renders every item with fallbacks", () => {
  const { items, previews } = buildSharedCalendarItems(rpc(), new Map(), helpers);
  assert.equal(items.length, 4);
  assert.ok(items.every((i) => i.item.thumbnailUrl === null));
  assert.ok(Object.values(previews).every((p) => p.media.length === 0));
});

// ---------- static checks on the migration and the guest bundle ----------

const sql = readFileSync(new URL("../../supabase/add_calendar_share_links.sql", import.meta.url), "utf8")
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

test("migration: no anon table access, no storage policy, RLS on, owner/admin only", () => {
  assert.match(sql, /alter table public\.calendar_share_links enable row level security/);
  assert.match(sql, /revoke all on public\.calendar_share_links from anon/);
  assert.doesNotMatch(sql, /grant[^;]*calendar_share_links[^;]*\banon\b/i);
  assert.doesNotMatch(sql, /storage\.objects/i);
  assert.doesNotMatch(sql, /for update/i);
  const policies = sql.match(/create policy[^;]*;/gi) ?? [];
  assert.equal(policies.length, 3);
  for (const p of policies) {
    assert.match(p, /to authenticated/);
    assert.match(p, /project_role\(project_id\) in \('owner', 'admin'\)/);
  }
  assert.match(sql, /token text not null unique check \(token ~ '\^\[A-Za-z0-9_-\]\{43\}\$'\)/);
});

test("migration: RPC is definer-safe and returns display fields only", () => {
  const fn = sql.slice(sql.indexOf("create or replace function public.get_shared_calendar"));
  assert.match(fn, /security definer/);
  assert.match(fn, /set search_path = public/);
  assert.match(fn, /revoke all on function public\.get_shared_calendar\(text, date\) from public/);
  assert.match(fn, /grant execute on function public\.get_shared_calendar\(text, date\) to anon, authenticated/);
  assert.match(fn, /p\.archived = false/);
  // Every content query is scoped to the token's project.
  assert.equal((fn.match(/project_id = v_link\.project_id/g) ?? []).length, 3);
  // Internal fields never selected.
  for (const field of ["notes", "review_status", "st.name", "comments", "project_members", "created_by", "annotation_json"]) {
    assert.ok(!new RegExp(`\\b${field.replace(".", "\\.")}\\b`).test(fn.replace(/'notes'|calendar_notes|n\.date|n\.body/g, "")), field);
  }
  // No writes from the guest path.
  assert.doesNotMatch(fn, /\b(update|insert|delete)\b/i);
});

const guestSource = readFileSync(new URL("../app/preview-calendar/[token]/guest-calendar.tsx", import.meta.url), "utf8");
const viewSource = readFileSync(new URL("../app/projects/[projectId]/calendar/calendar-view.tsx", import.meta.url), "utf8");

test("guest bundle: no server actions, drag/drop, editors or in-app links", () => {
  for (const src of [guestSource, viewSource]) {
    assert.doesNotMatch(src, /@\/lib\/actions/);
    assert.doesNotMatch(src, /@dnd-kit/);
    assert.doesNotMatch(src, /MentionField|mention-input/);
  }
  assert.doesNotMatch(guestSource, /next\/link|href=|useRouter/);
  assert.doesNotMatch(guestSource, /onDayMenu|onOpenDayDetail|aside=|DropTarget/);
});

console.log(`\n${passed} passed`);
