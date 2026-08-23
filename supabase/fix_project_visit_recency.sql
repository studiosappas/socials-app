-- Per-user "most recently visited project" tracking for the Projects page.
--
-- WHY: the Projects list previously had no notion of "the project I was
-- just working in" -- the only existing recency signal anywhere (nav
-- switcher ordering, the landing-page redirect fallback) is
-- projects.created_at, which is shared across the whole team and never
-- reflects one individual user's own navigation. This adds a per-
-- (project_id, user_id) timestamp on the existing project_members
-- membership row -- no new table, since project_members is already keyed
-- exactly (project_id, user_id), and this is set once per project entry,
-- never on every render/click/route inside an already-open project.
--
-- Run this in the Supabase SQL editor. Idempotent (safe to re-run) and
-- transactional (all-or-nothing, no window where the column is half-added).
--
-- The application already isolates every read/write of this column from
-- everything else (same "isolate new/pending-migration columns" pattern
-- already used for `archived`, `instagram_url`/`tiktok_url`, etc. elsewhere
-- in this codebase) -- so the Projects page, and project entry itself,
-- keep working exactly as before if this migration hasn't been applied yet;
-- recency ordering just silently falls back to created-date-first until it
-- is.
begin;

alter table public.project_members
  add column if not exists last_visited_at timestamptz;

-- Speeds up "this user's projects, most-recently-visited first" -- a
-- per-user ordering over what's normally a small (tens, not thousands) set
-- of rows per user, but the index costs nothing to have and matters once a
-- user belongs to many projects.
create index if not exists idx_project_members_user_last_visited
  on public.project_members (user_id, last_visited_at desc);

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------------
-- ROLLBACK -- only if you need to revert. Safe at any time: this only drops
-- the new column/index, no other data (memberships, roles, permissions) is
-- touched.
--
-- begin;
-- drop index if exists public.idx_project_members_user_last_visited;
-- alter table public.project_members drop column if exists last_visited_at;
-- notify pgrst, 'reload schema';
-- commit;
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- READ-ONLY POST-MIGRATION VERIFICATION -- run these after, no writes.
--
-- 1. Confirm the column and index now exist:
-- select column_name, data_type
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'project_members'
--   and column_name = 'last_visited_at';
--
-- select indexname from pg_indexes
-- where schemaname = 'public' and tablename = 'project_members'
--   and indexname = 'idx_project_members_user_last_visited';
--
-- 2. Confirm no existing membership rows were touched/lost (compare this
--    count to whatever you already know project_members' row count to be):
-- select count(*) from public.project_members;
--
-- 3. Confirm every row's new column starts out null (nothing is
--    retroactively marked "visited" -- ordering falls back to created-date
--    for every project until a user actually opens it again):
-- select count(*) from public.project_members where last_visited_at is not null;
-- -- expect: 0 immediately after migration
-- ---------------------------------------------------------------------------
