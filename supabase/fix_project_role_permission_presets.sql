-- Closes a real, narrow gap surfaced while formalizing Flow:er's project
-- role -> permission-preset architecture: RLS today distinguishes only
-- "any project member" vs "owner/admin" -- there is no policy anywhere that
-- treats 'client' or 'viewer' any differently from 'editor'/'admin'/'owner'
-- for WRITES. Concretely, today, an authenticated 'client'-role or
-- 'viewer'-role project member CAN, via a direct Supabase call bypassing
-- the app's own UI/Server Actions entirely:
--   - upload media assets (media_assets insert, project-media storage
--     insert/update)
--   - create/update/delete ANY task in the project (not just their own)
-- despite the product intent that Client is "primarily a reviewer" and
-- neither Client nor Viewer is meant to operate the workspace. This
-- narrows exactly those write paths to owner/admin/editor -- the three
-- roles whose default permission preset includes real workspace pages --
-- while leaving every READ policy (any project member can still see media
-- and tasks) and every other table's RLS completely untouched.
--
-- Deliberately NOT touched by this migration (reported as a separate,
-- larger, out-of-scope architectural note rather than folded in here):
-- posts/stories/grid_rows/grid_slots/calendar_notes/brief_*/etc. are
-- already owner/admin-only for writes at the RLS layer (and canManage,
-- app-side, already hides their edit controls from anyone else) -- an
-- 'editor'/"Member" role today has read-only access to those tables
-- regardless of this migration. Widening THOSE policies so "Member" can
-- actually create/edit Grid/Calendar/Brief/Content, not just view them, is
-- a materially larger change (it touches ~15 more RLS policies plus every
-- page's canManage computation) that's out of scope for this pass -- see
-- the accompanying report for the full explanation. This migration only
-- closes the two confirmed CLIENT-facing gaps above.
--
-- Run this in the Supabase SQL editor. Idempotent (safe to re-run) and
-- transactional. Purely additive-restrictive: it only NARROWS who can
-- write to these three surfaces, and does not touch any existing row's
-- data, membership, role, or custom_permissions.
begin;

-- ---------- media_assets: upload restricted to owner/admin/editor ----------
drop policy if exists "Members can upload media" on public.media_assets;
create policy "Owners/admins/editors can upload media"
  on public.media_assets for insert to authenticated
  with check (
    public.is_project_member(project_id)
    and public.project_role(project_id) in ('owner', 'admin', 'editor')
    and uploaded_by = auth.uid()
  );

-- ---------- project-media storage: upload/update restricted the same way ----------
drop policy if exists "Members can upload project media" on storage.objects;
create policy "Owners/admins/editors can upload project media"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'project-media'
    and public.is_project_member((storage.foldername(name))[1]::uuid)
    and public.project_role((storage.foldername(name))[1]::uuid) in ('owner', 'admin', 'editor')
  );

drop policy if exists "Members can update project media" on storage.objects;
create policy "Owners/admins/editors can update project media"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'project-media'
    and public.is_project_member((storage.foldername(name))[1]::uuid)
    and public.project_role((storage.foldername(name))[1]::uuid) in ('owner', 'admin', 'editor')
  )
  with check (
    bucket_id = 'project-media'
    and public.is_project_member((storage.foldername(name))[1]::uuid)
    and public.project_role((storage.foldername(name))[1]::uuid) in ('owner', 'admin', 'editor')
  );

-- ---------- tasks: split view (unchanged, any member) from manage (narrowed) ----------
-- Personal (unlinked, project_id is null) tasks are completely unaffected
-- either way -- both new policies preserve the exact same
-- "project_id is null and user_id = auth.uid()" self-service clause the
-- single combined policy already had.
drop policy if exists "Members manage project tasks, users manage personal tasks" on public.tasks;

create policy "Members view project tasks, users view personal tasks"
  on public.tasks for select to authenticated
  using (
    (project_id is not null and public.is_project_member(project_id))
    or (project_id is null and user_id = auth.uid())
  );

create policy "Owners/admins/editors manage project tasks, users manage personal tasks"
  on public.tasks for insert to authenticated
  with check (
    (project_id is not null and public.project_role(project_id) in ('owner', 'admin', 'editor'))
    or (project_id is null and user_id = auth.uid())
  );

create policy "Owners/admins/editors update project tasks, users update personal tasks"
  on public.tasks for update to authenticated
  using (
    (project_id is not null and public.project_role(project_id) in ('owner', 'admin', 'editor'))
    or (project_id is null and user_id = auth.uid())
  )
  with check (
    (project_id is not null and public.project_role(project_id) in ('owner', 'admin', 'editor'))
    or (project_id is null and user_id = auth.uid())
  );

create policy "Owners/admins/editors delete project tasks, users delete personal tasks"
  on public.tasks for delete to authenticated
  using (
    (project_id is not null and public.project_role(project_id) in ('owner', 'admin', 'editor'))
    or (project_id is null and user_id = auth.uid())
  );

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------------
-- ROLLBACK -- restores the exact three original (broader) policies. Safe at
-- any time -- this only changes who's ALLOWED to write, no data is touched.
--
-- begin;
-- drop policy if exists "Owners/admins/editors can upload media" on public.media_assets;
-- create policy "Members can upload media"
--   on public.media_assets for insert to authenticated
--   with check (public.is_project_member(project_id) and uploaded_by = auth.uid());
--
-- drop policy if exists "Owners/admins/editors can upload project media" on storage.objects;
-- create policy "Members can upload project media"
--   on storage.objects for insert to authenticated
--   with check (
--     bucket_id = 'project-media'
--     and public.is_project_member((storage.foldername(name))[1]::uuid)
--   );
--
-- drop policy if exists "Owners/admins/editors can update project media" on storage.objects;
-- create policy "Members can update project media"
--   on storage.objects for update to authenticated
--   using (bucket_id = 'project-media' and public.is_project_member((storage.foldername(name))[1]::uuid))
--   with check (bucket_id = 'project-media' and public.is_project_member((storage.foldername(name))[1]::uuid));
--
-- drop policy if exists "Members view project tasks, users view personal tasks" on public.tasks;
-- drop policy if exists "Owners/admins/editors manage project tasks, users manage personal tasks" on public.tasks;
-- drop policy if exists "Owners/admins/editors update project tasks, users update personal tasks" on public.tasks;
-- drop policy if exists "Owners/admins/editors delete project tasks, users delete personal tasks" on public.tasks;
-- create policy "Members manage project tasks, users manage personal tasks"
--   on public.tasks for all to authenticated
--   using (
--     (project_id is not null and public.is_project_member(project_id))
--     or (project_id is null and user_id = auth.uid())
--   )
--   with check (
--     (project_id is not null and public.is_project_member(project_id))
--     or (project_id is null and user_id = auth.uid())
--   );
--
-- notify pgrst, 'reload schema';
-- commit;
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- READ-ONLY POST-MIGRATION VERIFICATION -- run these after, no writes.
--
-- 1. Confirm the new policies exist and old ones are gone:
-- select tablename, policyname, cmd
-- from pg_policies
-- where schemaname in ('public', 'storage')
--   and tablename in ('media_assets', 'objects', 'tasks')
-- order by tablename, policyname;
--
-- 2. Confirm no existing rows were touched/lost (compare these counts to
--    whatever you already know them to be before running):
-- select count(*) from public.media_assets;
-- select count(*) from public.tasks;
--
-- 3. Confirm every existing project_members row's role/custom_permissions
--    is completely untouched (this migration only changes RLS policies,
--    never writes to project_members itself):
-- select role, count(*) from public.project_members group by role order by 1;
-- ---------------------------------------------------------------------------
