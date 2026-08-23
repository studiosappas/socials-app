-- Content PDF/video support: widen media_assets.media_type's CHECK
-- constraint to allow 'pdf' alongside the existing 'image'/'video'.
--
-- ROOT CAUSE: schema.sql and the application code were updated (feature
-- branch feat/content-media-types-and-cluster-labels) to send media_type
-- 'video'/'pdf' for Content page uploads, but this migration -- which
-- actually changes the live database's CHECK constraint -- was never
-- applied. Every video/PDF upload attempt against the real database fails
-- with:
--   new row for relation "media_assets" violates check constraint
--   "media_assets_media_type_check"
-- because the constraint currently deployed still only permits
-- ('image', 'video'). Note video ALSO currently fails in Preview for this
-- exact reason -- this migration is required for both, not just PDF.
--
-- Run this in the Supabase SQL editor. Idempotent (safe to re-run) and
-- transactional (all-or-nothing, no window where the constraint is
-- missing entirely).
begin;

-- ---------------------------------------------------------------------------
-- Canonical media_type vocabulary: 'image' | 'video' | 'pdf' (all three
-- already the exact literal strings the application sends -- see
-- src/lib/video-poster.ts's mediaType detection and
-- src/types/database.ts's MediaType union. No alias/synonym anywhere:
-- never "document", never "application/pdf" stored as a value, that MIME
-- string is only ever used client-side to detect the file, never persisted.
--
-- `media_assets_media_type_check` is confirmed (not guessed) as the real
-- constraint name -- it's the exact name Postgres cited in the violation
-- error this migration fixes, so this DROP will find and remove it.
--
-- Existing rows are unaffected: every media_assets row in this database
-- was inserted through this same application, whose only two write paths
-- for media_type (grid.ts's uploadMedia, and the older
-- image/video-only stories.ts actions) have only ever set 'image' or
-- 'video' -- both remain valid under the new constraint unchanged, so no
-- existing row can violate it. This ADDS 'pdf' to the allowed set; it does
-- not remove or narrow anything, and no UPDATE is run against existing
-- data -- zero rows are rewritten.
-- ---------------------------------------------------------------------------
alter table public.media_assets drop constraint if exists media_assets_media_type_check;
alter table public.media_assets add constraint media_assets_media_type_check
  check (media_type in ('image', 'video', 'pdf'));

-- Force PostgREST to reload its schema cache so the widened constraint
-- (and anything else pending) is picked up immediately, not after its own
-- next periodic refresh.
notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------------
-- ROLLBACK -- only if you need to revert. Safe to run as long as no 'pdf'
-- rows have been inserted yet (if any have, this DROP+ADD would then fail
-- with the same violation error this migration fixes, applied in reverse --
-- delete or re-type those rows first if you ever need to roll back after
-- 'pdf' rows exist).
--
-- begin;
-- alter table public.media_assets drop constraint if exists media_assets_media_type_check;
-- alter table public.media_assets add constraint media_assets_media_type_check
--   check (media_type in ('image', 'video'));
-- notify pgrst, 'reload schema';
-- commit;
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- READ-ONLY POST-MIGRATION VERIFICATION -- run these after, no writes.
--
-- 1. Confirm the constraint now allows all three values:
-- select conname, pg_get_constraintdef(oid)
-- from pg_constraint
-- where conrelid = 'public.media_assets'::regclass
--   and conname = 'media_assets_media_type_check';
-- -- expect: CHECK (media_type = ANY (ARRAY['image'::text, 'video'::text, 'pdf'::text]))
--
-- 2. Confirm no existing rows were touched/lost (compare this count to
--    whatever you already know the table's row count to be before running):
-- select media_type, count(*) from public.media_assets group by media_type order by 1;
-- ---------------------------------------------------------------------------
