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

-- Shared Client Preview: also return each post's aspect ratio and each
-- item's frame, so /preview shows the post at its chosen ratio and framing
-- (aspect_ratio NULL = unchanged legacy 3:4 cover crop). Same signature,
-- SECURITY DEFINER and grant as the current definition; only the two new
-- keys differ. Must run after the column additions above.
create or replace function public.get_shared_preview(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link record;
  v_items jsonb;
begin
  select id, project_id, title into v_link
  from share_links
  where token = p_token;

  if v_link.id is null then
    return null;
  end if;

  select coalesce(jsonb_agg(entry.data order by entry.position), '[]'::jsonb)
  into v_items
  from (
    select
      sli.position,
      jsonb_build_object(
        'id', sli.id,
        'type', case when sli.post_id is not null then 'post' else 'story' end,
        'postId', sli.post_id,
        'storyId', sli.story_id,
        'caption', coalesce((select p.caption from posts p where p.id = sli.post_id), ''),
        'notes', coalesce(
          (select p.notes from posts p where p.id = sli.post_id),
          (select s.notes from stories s where s.id = sli.story_id),
          ''
        ),
        'reviewStatus', coalesce(
          (select p.review_status from posts p where p.id = sli.post_id),
          (select s.review_status from stories s where s.id = sli.story_id),
          'pending'
        ),
        'coverTransform', (select p.cover_transform from posts p where p.id = sli.post_id),
        'aspectRatio', (select p.aspect_ratio from posts p where p.id = sli.post_id),
        'media', case
          when sli.post_id is not null then (
            select coalesce(jsonb_agg(jsonb_build_object(
              'mediaAssetId', ma.id,
              'storagePath', ma.storage_path,
              'previewStoragePath', ma.preview_storage_path,
              'posterStoragePath', ma.poster_storage_path,
              'mediaType', ma.media_type,
              'frameTransform', pa.frame_transform
            ) order by pa.position), '[]'::jsonb)
            from post_assets pa
            join media_assets ma on ma.id = pa.media_asset_id
            where pa.post_id = sli.post_id
          )
          else (
            select coalesce(jsonb_agg(jsonb_build_object(
              'mediaAssetId', ma.id,
              'storagePath', ma.storage_path,
              'previewStoragePath', ma.preview_storage_path,
              'posterStoragePath', ma.poster_storage_path,
              'mediaType', ma.media_type
            ) order by sf.position), '[]'::jsonb)
            from story_frames sf
            join media_assets ma on ma.id = sf.media_asset_id
            where sf.story_id = sli.story_id
          )
        end
      ) as data
    from share_link_items sli
    where sli.share_link_id = v_link.id
  ) entry;

  return jsonb_build_object(
    'title', v_link.title,
    'projectName', (select name from projects where id = v_link.project_id),
    'items', v_items,
    'members', (
      select coalesce(jsonb_agg(jsonb_build_object('id', pm.user_id, 'name', pr.name)), '[]'::jsonb)
      from project_members pm
      join profiles pr on pr.id = pm.user_id
      where pm.project_id = v_link.project_id
    )
  );
end;
$$;

grant execute on function public.get_shared_preview(text) to anon, authenticated;
