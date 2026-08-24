-- Adds VIDEO as a first-class Brief item kind, alongside the existing
-- 'link'/'image'. Two changes, both additive/widening, neither touches any
-- existing row's data:
--
--   1. brief_task_items.kind's CHECK constraint currently only allows
--      ('link', 'image') -- widened to also allow 'video'. Every existing
--      row already satisfies the new, looser constraint unchanged (it's a
--      superset of the old one), so this is a metadata-only change with no
--      data rewrite and no risk of an existing row suddenly violating it.
--
--   2. brief_attachments gets a new nullable poster_storage_path column,
--      used only for a video item's auto-generated poster/thumbnail frame
--      (mirrors media_assets.poster_storage_path's existing role for
--      Grid/Post/Story videos). NULL for every existing row (all of which
--      are images, which have no poster) and NULL for a video whose poster
--      generation failed -- the video item itself still saves fine either
--      way; the app falls back to a generic video icon when this is null.
--
-- Do NOT apply this yourself -- see the accompanying report. Run in the
-- Supabase SQL editor. Idempotent (safe to re-run) and transactional
-- (all-or-nothing).
begin;

-- brief_task_items_kind_check is Postgres's standard auto-generated name
-- for an inline CHECK on this column (<table>_<column>_check) -- the
-- `drop constraint if exists` is defensive (a no-op if the live name ever
-- differs), the `add constraint` below always (re)creates it with this
-- exact name and the widened, correct definition either way.
alter table public.brief_task_items drop constraint if exists brief_task_items_kind_check;
alter table public.brief_task_items add constraint brief_task_items_kind_check
  check (kind in ('link', 'image', 'video'));

alter table public.brief_attachments add column if not exists poster_storage_path text;

-- Force PostgREST to reload its schema cache so both changes (and anything
-- else pending) are picked up immediately, not after its own next periodic
-- refresh.
notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------------
-- ROLLBACK -- only if you need to revert.
--
-- Reverting the kind constraint is safe ONLY if no 'video' rows exist yet --
-- if any do, this DROP+ADD fails with the same violation error this
-- migration exists to prevent, applied in reverse (delete or re-type those
-- rows first if you ever need to roll back after real video items exist).
--
-- The poster_storage_path column is deliberately NOT dropped by default --
-- if any video items were added while this migration was live, their real
-- poster paths would be destroyed. Only drop it (separate statement below,
-- commented out on its own) once you've confirmed no video item still
-- depends on it.
--
-- begin;
-- alter table public.brief_task_items drop constraint if exists brief_task_items_kind_check;
-- alter table public.brief_task_items add constraint brief_task_items_kind_check
--   check (kind in ('link', 'image'));
-- notify pgrst, 'reload schema';
-- commit;
--
-- -- Only if you also want the column gone (destroys any stored poster
-- -- paths -- confirm nothing needs them first):
-- -- alter table public.brief_attachments drop column if exists poster_storage_path;
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- READ-ONLY VERIFICATION -- run after, no writes.
--
-- 1. Confirm the constraint now allows all three kinds:
-- select conname, pg_get_constraintdef(oid)
-- from pg_constraint
-- where conrelid = 'public.brief_task_items'::regclass
--   and conname = 'brief_task_items_kind_check';
-- -- expect: CHECK (kind = ANY (ARRAY['link'::text, 'image'::text, 'video'::text]))
--
-- 2. Confirm the new column exists and is nullable:
-- select column_name, data_type, is_nullable
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'brief_attachments'
--   and column_name = 'poster_storage_path';
-- -- expect: poster_storage_path | text | YES
--
-- 3. Confirm no existing rows were touched (every existing item is still
--    'link' or 'image', every existing attachment's poster_storage_path is
--    null -- compare this count to the table's known row count beforehand):
-- select kind, count(*) from public.brief_task_items group by kind order by 1;
-- select count(*) filter (where poster_storage_path is not null) as attachments_with_poster,
--        count(*) as total_attachments
-- from public.brief_attachments;
-- ---------------------------------------------------------------------------
