-- Grid Media Library source tabs ("Uploaded" / "From Content").
-- Nullable addition only: NULL = origin not recorded (every existing row,
-- and Brief's generated designs), shown under "Uploaded". No backfill.
-- Existing media_assets policies cover the new column. Safe to re-run.

-- Where the asset was ORIGINALLY uploaded, written once by the upload
-- action: 'grid' (Grid Library, Post Editor upload/replace) or 'content'
-- (the Content page and Content editor). Never derived from current usage.
alter table public.media_assets
  add column if not exists upload_source text null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'media_assets_upload_source_check') then
    alter table public.media_assets
      add constraint media_assets_upload_source_check check (upload_source in ('grid', 'content'));
  end if;
end $$;

-- Make the API see the new column immediately, so uploads start recording
-- their source right away instead of falling back until the next reload.
notify pgrst, 'reload schema';
