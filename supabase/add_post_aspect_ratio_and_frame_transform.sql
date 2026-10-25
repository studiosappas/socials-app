-- Unified aspect ratio (Post / Reel cover / Carousel).
-- Nullable additions only: NULL keeps every existing post on its current
-- (legacy) behaviour. No backfill. Existing table policies cover the new
-- columns. Safe to re-run.

-- The post's chosen EXPORT ratio: a Post's / Carousel's images (a carousel's
-- is set from its first slide), or a standalone Reel's COVER IMAGE. The Grid
-- stays 3:4 regardless.
alter table public.posts
  add column if not exists aspect_ratio text null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'posts_aspect_ratio_check') then
    alter table public.posts
      add constraint posts_aspect_ratio_check check (aspect_ratio in ('original', '1:1', '4:5', '9:16'));
  end if;
end $$;

-- An item's own, non-destructive export framing inside that ratio
-- ({ scale, x, y, rotation }, same model as posts.cover_transform). For a
-- Reel's video item: its cover image's framing (the video is never touched).
alter table public.post_assets
  add column if not exists frame_transform jsonb null;
