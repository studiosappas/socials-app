-- Adds the 5:4, 16:9 and 9:16-for-feed aspect ratio choices (lib/aspect-ratio.ts).
-- Requires add_post_aspect_ratio_and_frame_transform.sql first.
-- Only widens the allowed values: every existing row (null or one of the old
-- four) still passes, so re-adding the constraint can't fail on current
-- data. No data changes, no backfill. Safe to re-run.
alter table public.posts drop constraint if exists posts_aspect_ratio_check;
alter table public.posts
  add constraint posts_aspect_ratio_check
  check (aspect_ratio in ('original', '1:1', '4:5', '5:4', '16:9', '9:16'));
