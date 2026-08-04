-- Sprint 08 schema additions. Idempotent -- safe to run even if some pieces
-- already exist. Run this once in the Supabase SQL editor, alongside the
-- still-pending fix_projects_ig_columns.sql and fix_batch2_schema.sql.

-- Grid tile crop/zoom/reposition (double-click crop mode). Stores a light
-- CSS-transform-style crop -- {scale, x, y} -- applied at render time; the
-- original asset is never modified.
alter table public.grid_slots
  add column if not exists cover_transform jsonb;

-- Settings page: user profile photo storage.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "Anyone can read avatars" on storage.objects;
create policy "Anyone can read avatars"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'avatars');

drop policy if exists "Users can upload their own avatar" on storage.objects;
create policy "Users can upload their own avatar"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users can update their own avatar" on storage.objects;
create policy "Users can update their own avatar"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

notify pgrst, 'reload schema';
