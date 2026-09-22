-- One-time backfill: hides pre-existing copy-on-write divergence clones
-- from the Library, without deleting or otherwise touching them.
--
-- WHY: cloneMediaAssetForDivergence (lib/actions/media.ts) creates an
-- internal per-post editable instance whenever a Library asset needs to
-- diverge from another post already using it (same-asset "reset to clean
-- Library source", or an edit onto an asset shared with another post).
-- Every clone it creates now sets archived = true at creation time, which
-- every Library-listing query in this codebase (Grid, Post Editor,
-- Stories -- see grid/page.tsx, lib/data/posts.ts, lib/data/stories.ts)
-- already filters out, and nothing anywhere browses archived = true rows
-- to "restore" them (grep-confirmed) -- this is the SAME "hidden from the
-- Library picker, row/file stay fully intact" mechanism deleteMedia
-- already uses for a still-referenced deleted asset, not new schema.
-- Grid's own cover-resolution query never filters on archived, so an
-- archived clone keeps rendering exactly as before for whatever post
-- already uses it.
--
-- That fix only covers clones created AFTER it shipped. Clones created
-- before it (during this feature's own QA) are still archived = false,
-- so they still show up as apparent duplicates in the Library today. This
-- backfill finds and archives those, using a rule proven safe from this
-- codebase's own actual invariants, not a heuristic:
--
--   Every genuine user upload (uploadMedia, uploadPostAsset,
--   uploadStoryFrame, replacePostAsset's upload branch, Brief's Generate
--   Design) generates storage_path via a freshly random path at upload
--   time -- grep-confirmed across all 7 non-clone insert call sites in
--   this codebase. None of them ever copies an existing row's
--   storage_path. cloneMediaAssetForDivergence is the ONLY code path that
--   ever inserts a media_assets row whose storage_path duplicates another
--   row's -- it copies the source's storage_path verbatim, on purpose (the
--   clone points at the same underlying image bytes).
--
--   Therefore: within one project, two or more media_assets rows sharing
--   the identical storage_path can ONLY happen via this clone mechanism --
--   never via two independent legitimate uploads, regardless of whether
--   their visual content happens to be identical. And within any such
--   group, the EARLIEST created_at is always the true original: a clone
--   is only ever created strictly after the row it was cloned from
--   already exists. This holds even for a clone-of-a-clone chain (created
--   if a slot's asset gets reset/diverged more than once) -- the group-
--   wide "earliest survives, everything else in the group gets archived"
--   rule doesn't need to know the chain's shape, only that it's ordered
--   by time.
--
-- Nothing is deleted. No storage_path, annotation_json, preview_
-- storage_path, or post_assets relation is touched -- only the existing
-- `archived` flag is flipped on rows this identifies as clones. A clone
-- currently serving as some post's real, edited cover is UNCHANGED in
-- every way that matters to that post; it only stops being offered again
-- in the Library picker.
--
-- Run the PREVIEW query first and read it. Only run the UPDATE once
-- you're satisfied the rows it lists are genuinely divergence clones, not
-- something else.

-- ---------------------------------------------------------------------------
-- STEP 1 -- PREVIEW (read-only, safe to run any time). Lists exactly which
-- rows this backfill would archive, alongside the row it considers the
-- "original" they were grouped with.
-- ---------------------------------------------------------------------------
with grouped as (
  select
    id,
    project_id,
    storage_path,
    archived,
    created_at,
    row_number() over (
      partition by project_id, storage_path
      order by created_at asc, id asc
    ) as rn
  from public.media_assets
)
select
  dup.id as clone_id,
  dup.project_id,
  dup.storage_path,
  dup.archived as currently_archived,
  dup.created_at as clone_created_at,
  orig.id as original_id,
  orig.created_at as original_created_at
from grouped dup
join grouped orig
  on orig.project_id = dup.project_id
  and orig.storage_path = dup.storage_path
  and orig.rn = 1
where dup.rn > 1
order by dup.project_id, dup.storage_path, dup.created_at;

-- ---------------------------------------------------------------------------
-- STEP 2 -- APPLY. Only archives rows the preview above already showed you.
-- Idempotent (safe to re-run -- already-archived rows are simply skipped).
-- ---------------------------------------------------------------------------
-- begin;
--
-- with ranked as (
--   select
--     id,
--     row_number() over (
--       partition by project_id, storage_path
--       order by created_at asc, id asc
--     ) as rn
--   from public.media_assets
-- )
-- update public.media_assets m
-- set archived = true
-- from ranked r
-- where m.id = r.id
--   and r.rn > 1
--   and m.archived = false;
--
-- commit;
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- ROLLBACK -- only if you need to revert this specific backfill. Re-run the
-- PREVIEW query first to get the exact clone_id list, then:
--
-- begin;
-- update public.media_assets set archived = false where id in (/* clone_id values from the preview */);
-- commit;
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- READ-ONLY POST-BACKFILL VERIFICATION -- run after STEP 2, no writes.
--
-- 1. Confirm no more duplicate, unarchived storage_paths remain:
-- select project_id, storage_path, count(*) as unarchived_count
-- from public.media_assets
-- where archived = false
-- group by project_id, storage_path
-- having count(*) > 1;
-- -- expect: 0 rows
--
-- 2. Confirm nothing was deleted (compare to the row count before running):
-- select count(*) from public.media_assets;
--
-- 3. Confirm every post that was using a clone as its cover still resolves
--    to that exact same asset id (spot-check a few post ids you know were
--    involved in QA):
-- select p.id as post_id, pa.media_asset_id, ma.archived
-- from public.posts p
-- join public.post_assets pa on pa.post_id = p.id and pa.position = 0
-- join public.media_assets ma on ma.id = pa.media_asset_id
-- where p.id in (/* post ids to spot-check */);
-- ---------------------------------------------------------------------------
