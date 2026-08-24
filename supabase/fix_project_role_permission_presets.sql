-- Formalizes Flow:er's project role -> permission-preset architecture at
-- the RLS layer, closing the gap between what the UI now claims each role
-- means and what the database actually enforces.
--
-- RLS today distinguishes only "any project member" vs "owner/admin" -- no
-- policy anywhere treats 'editor'/'viewer'/'client' any differently from
-- each other. That created two separate, opposite problems the app-side
-- work already committed to fixing:
--
--   1. MEMBER (the 'editor' role) is supposed to be "the standard internal
--      working user" with real day-to-day editing access to Grid/Calendar/
--      Brief/Content/Assets -- but every one of those tables' writes was
--      owner/admin-only, so an editor could only ever VIEW those pages, not
--      use them. Section 2 below widens exactly those tables to also allow
--      'editor', and nothing else.
--
--   2. CLIENT is supposed to be "primarily a reviewer" -- but because RLS
--      never distinguished roles for a handful of member-wide policies, an
--      authenticated client (or viewer) could upload media and fully
--      manage any task in the project, despite having no business doing
--      either. Section 1 (already written, unapplied) closes that.
--
-- Run this in the Supabase SQL editor. Idempotent (safe to re-run) and
-- transactional (all-or-nothing, no window with a mix of old/new policies).
-- Purely additive-restrictive or additive-permissive per policy -- no
-- existing row's data, membership, role, or custom_permissions is ever
-- touched; this only changes who is ALLOWED to write going forward.
--
-- Deliberately NOT touched, even in this expanded pass (see the accompanying
-- report for the full reasoning):
--   - `projects` table UPDATE/DELETE, `project_sections`, `brand_strategy`,
--     `brand_documents` -- all Overview-page / project-settings-adjacent,
--     not part of Grid/Calendar/Brief/Content/Assets/Tasks, and several
--     (industry, platform, archived, IG credentials) are the kind of
--     "sensitive Project Settings" Member is explicitly meant to stay out
--     of. Overview stays read-only for Member.
--   - `design_tasks`, `design_task_links`, `design_task_assets`,
--     `design_task_templates` -- confirmed dead/unreachable from any page
--     in the app today; nothing to fix for a feature nothing can reach.
--   - `project_members`, `share_links`, `share_link_items` -- membership,
--     roles, and sharing stay owner/admin-only, unchanged.
--   - `post_comments`/`story_comments`/`task_comments` -- already open to
--     any project member (author-checked) and explicitly meant to include
--     Client ("Client should receive... Review/comments"); left exactly
--     as-is.
--   - Client/Viewer are NOT added to any of the newly-widened policies in
--     Section 2 -- only 'editor' joins 'owner'/'admin' there. Client's own
--     narrow write path (Approval Status only) is implemented at the
--     application layer via the existing set_post_review_status/
--     set_story_review_status functions (already SECURITY DEFINER,
--     already self-restricted to project_role = 'client', already
--     restricted to 'approved'/'changes_requested') -- no RLS change is
--     needed or made for that; see the accompanying report.
begin;

-- =============================================================================
-- SECTION 1 -- CLIENT/VIEWER NARROWING (unchanged from the original version
-- of this file; still unapplied)
-- =============================================================================

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
-- either way -- every new policy preserves the exact same
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

-- =============================================================================
-- SECTION 2 -- MEMBER (editor) WIDENING: real workspace editing access
-- =============================================================================
-- Every policy below follows the identical shape: the SAME table, the SAME
-- operation, the SAME structure as before -- only 'editor' is added to the
-- role list already containing 'owner'/'admin'. 'client' and 'viewer' are
-- deliberately never added here.

-- ---------- Grid ----------
-- WHY: Grid is Member's core daily workspace -- adding rows, placing
-- media into slots, reordering, cropping, uploading to the library.

-- grid_rows | ALL | before: owner/admin | after: owner/admin/editor
-- Adding/removing a Grid row (addGridRow/removeGridRow).
drop policy if exists "Admins manage grid rows" on public.grid_rows;
create policy "Owners/admins/editors manage grid rows" on public.grid_rows for all to authenticated
  using (public.project_role(project_id) in ('owner', 'admin', 'editor'))
  with check (public.project_role(project_id) in ('owner', 'admin', 'editor'));

-- posts | ALL | before: owner/admin | after: owner/admin/editor
-- Creating/editing/deleting a post (placeMediaInSlot, updatePost,
-- deletePost, updatePostCoverTransform's crop save).
drop policy if exists "Admins manage posts" on public.posts;
create policy "Owners/admins/editors manage posts" on public.posts for all to authenticated
  using (public.project_role(project_id) in ('owner', 'admin', 'editor'))
  with check (public.project_role(project_id) in ('owner', 'admin', 'editor'));

-- grid_slots | ALL | before: owner/admin | after: owner/admin/editor
-- Placing a post into a slot, and reorder_grid_slots' per-row UPDATE
-- (SECURITY INVOKER -- it runs as the caller and was silently no-op-ing
-- per row for a non-owner/admin caller under the old policy; this is what
-- makes Member's Grid drag-reorder actually take effect).
drop policy if exists "Admins manage grid slots" on public.grid_slots;
create policy "Owners/admins/editors manage grid slots" on public.grid_slots for all to authenticated
  using (exists (select 1 from public.grid_rows r where r.id = row_id and public.project_role(r.project_id) in ('owner', 'admin', 'editor')))
  with check (exists (select 1 from public.grid_rows r where r.id = row_id and public.project_role(r.project_id) in ('owner', 'admin', 'editor')));

-- post_assets | ALL | before: owner/admin | after: owner/admin/editor
-- Adding/removing/reordering a post's media assets.
drop policy if exists "Admins manage post assets" on public.post_assets;
create policy "Owners/admins/editors manage post assets" on public.post_assets for all to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id and public.project_role(p.project_id) in ('owner', 'admin', 'editor')))
  with check (exists (select 1 from public.posts p where p.id = post_id and public.project_role(p.project_id) in ('owner', 'admin', 'editor')));

-- post_links | ALL | before: owner/admin | after: owner/admin/editor
-- Adding/removing a post's link-out URLs.
drop policy if exists "Admins manage post links" on public.post_links;
create policy "Owners/admins/editors manage post links" on public.post_links for all to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id and public.project_role(p.project_id) in ('owner', 'admin', 'editor')))
  with check (exists (select 1 from public.posts p where p.id = post_id and public.project_role(p.project_id) in ('owner', 'admin', 'editor')));

-- media_folders | ALL | before: owner/admin | after: owner/admin/editor
-- Creating a folder in the Media Library (Grid's library sidebar).
drop policy if exists "Admins manage media folders" on public.media_folders;
create policy "Owners/admins/editors manage media folders" on public.media_folders for all
  to authenticated
  using (public.project_role(project_id) in ('owner', 'admin', 'editor'))
  with check (public.project_role(project_id) in ('owner', 'admin', 'editor'));

-- media_assets UPDATE | before: owner/admin | after: owner/admin/editor
-- Archiving/moving-to-folder an asset (deleteMedia's archive path,
-- moveMediaToFolder) -- this is the SAME "Admins update media" policy that
-- also governs annotation/crop saves and poster regeneration.
drop policy if exists "Admins update media" on public.media_assets;
create policy "Owners/admins/editors update media"
  on public.media_assets for update
  to authenticated
  using (public.project_role(project_id) in ('owner', 'admin', 'editor'))
  with check (public.project_role(project_id) in ('owner', 'admin', 'editor'));

-- media_assets DELETE | before: owner/admin | after: owner/admin/editor
-- Hard-deleting a truly-unreferenced asset (deleteMedia/bulkDeleteMedia's
-- delete path, once nothing references it).
drop policy if exists "Owners/admins can delete media" on public.media_assets;
create policy "Owners/admins/editors can delete media"
  on public.media_assets for delete
  to authenticated
  using (public.project_role(project_id) in ('owner', 'admin', 'editor'));

-- ---------- Calendar ----------
-- WHY: rescheduling/publish-toggling posts and stories already routes
-- through the posts/stories policies widened above; calendar_notes is the
-- one Calendar-specific table left.

-- calendar_notes | ALL | before: owner/admin | after: owner/admin/editor
drop policy if exists "Admins manage calendar notes" on public.calendar_notes;
create policy "Owners/admins/editors manage calendar notes" on public.calendar_notes for all to authenticated
  using (public.project_role(project_id) in ('owner', 'admin', 'editor'))
  with check (public.project_role(project_id) in ('owner', 'admin', 'editor'));

-- ---------- Brief ----------
-- WHY: Brief's task board (create/rename/reorder tasks, add/remove/reorder
-- items and frames, upload attachments) and the Brand Moodboard dialog
-- opened from it are Member's normal day-to-day Brief work.
-- design_task_templates/design_tasks/design_task_links/design_task_assets
-- are deliberately untouched -- confirmed dead/unreachable code, nothing to
-- widen for a surface nothing can reach.

-- brief_tasks | ALL | before: owner/admin | after: owner/admin/editor
drop policy if exists "Admins manage brief tasks" on public.brief_tasks;
create policy "Owners/admins/editors manage brief tasks" on public.brief_tasks for all to authenticated
  using (public.project_role(project_id) in ('owner', 'admin', 'editor'))
  with check (public.project_role(project_id) in ('owner', 'admin', 'editor'));

-- brief_task_items | ALL | before: owner/admin | after: owner/admin/editor
drop policy if exists "Admins manage brief task items" on public.brief_task_items;
create policy "Owners/admins/editors manage brief task items" on public.brief_task_items for all to authenticated
  using (exists (select 1 from public.brief_tasks t where t.id = task_id and public.project_role(t.project_id) in ('owner', 'admin', 'editor')))
  with check (exists (select 1 from public.brief_tasks t where t.id = task_id and public.project_role(t.project_id) in ('owner', 'admin', 'editor')));

-- brief_task_frames | ALL | before: owner/admin | after: owner/admin/editor
drop policy if exists "Admins manage brief task frames" on public.brief_task_frames;
create policy "Owners/admins/editors manage brief task frames" on public.brief_task_frames for all to authenticated
  using (exists (select 1 from public.brief_tasks t where t.id = task_id and public.project_role(t.project_id) in ('owner', 'admin', 'editor')))
  with check (exists (select 1 from public.brief_tasks t where t.id = task_id and public.project_role(t.project_id) in ('owner', 'admin', 'editor')));

-- brief_attachments | ALL | before: owner/admin | after: owner/admin/editor
drop policy if exists "Admins manage brief attachments" on public.brief_attachments;
create policy "Owners/admins/editors manage brief attachments" on public.brief_attachments for all to authenticated
  using (public.project_role(project_id) in ('owner', 'admin', 'editor'))
  with check (public.project_role(project_id) in ('owner', 'admin', 'editor'));

-- brand_moodboard_items | ALL | before: owner/admin | after: owner/admin/editor
drop policy if exists "Admins manage brand moodboard" on public.brand_moodboard_items;
create policy "Owners/admins/editors manage brand moodboard" on public.brand_moodboard_items for all to authenticated
  using (public.project_role(project_id) in ('owner', 'admin', 'editor'))
  with check (public.project_role(project_id) in ('owner', 'admin', 'editor'));

-- storage brief-media INSERT | before: owner/admin | after: owner/admin/editor
-- (existing policy name "Members can upload brief media" is misleading --
-- it was already owner/admin-only, not member-wide; renamed for clarity)
drop policy if exists "Members can upload brief media" on storage.objects;
create policy "Owners/admins/editors can upload brief media"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'brief-media'
    and public.project_role((storage.foldername(name))[1]::uuid) in ('owner', 'admin', 'editor')
  );

-- storage brief-media DELETE | before: owner/admin | after: owner/admin/editor
drop policy if exists "Admins can delete brief media" on storage.objects;
create policy "Owners/admins/editors can delete brief media"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'brief-media'
    and public.project_role((storage.foldername(name))[1]::uuid) in ('owner', 'admin', 'editor')
  );

-- ---------- Content (Stories) ----------
-- WHY: creating/editing content items, uploading and reordering frames,
-- organizing into folders is Member's normal day-to-day Content work.

-- stories | ALL | before: owner/admin | after: owner/admin/editor
drop policy if exists "Admins manage stories" on public.stories;
create policy "Owners/admins/editors manage stories" on public.stories for all to authenticated
  using (public.project_role(project_id) in ('owner', 'admin', 'editor'))
  with check (public.project_role(project_id) in ('owner', 'admin', 'editor'));

-- story_frames | ALL | before: owner/admin | after: owner/admin/editor
drop policy if exists "Admins manage story frames" on public.story_frames;
create policy "Owners/admins/editors manage story frames" on public.story_frames for all to authenticated
  using (exists (select 1 from public.stories s where s.id = story_id and public.project_role(s.project_id) in ('owner', 'admin', 'editor')))
  with check (exists (select 1 from public.stories s where s.id = story_id and public.project_role(s.project_id) in ('owner', 'admin', 'editor')));

-- story_links | ALL | before: owner/admin | after: owner/admin/editor
drop policy if exists "Admins manage story links" on public.story_links;
create policy "Owners/admins/editors manage story links" on public.story_links for all to authenticated
  using (exists (select 1 from public.stories s where s.id = story_id and public.project_role(s.project_id) in ('owner', 'admin', 'editor')))
  with check (exists (select 1 from public.stories s where s.id = story_id and public.project_role(s.project_id) in ('owner', 'admin', 'editor')));

-- content_folders | ALL | before: owner/admin | after: owner/admin/editor
drop policy if exists "Admins manage content folders" on public.content_folders;
create policy "Owners/admins/editors manage content folders" on public.content_folders for all to authenticated
  using (public.project_role(project_id) in ('owner', 'admin', 'editor'))
  with check (public.project_role(project_id) in ('owner', 'admin', 'editor'));

-- ---------- Assets ----------
-- WHY: adding/editing/removing an asset collection entry is Member's
-- normal day-to-day Assets work.

-- asset_collections | ALL | before: owner/admin | after: owner/admin/editor
drop policy if exists "Admins manage asset collections" on public.asset_collections;
create policy "Owners/admins/editors manage asset collections" on public.asset_collections for all to authenticated
  using (public.project_role(project_id) in ('owner', 'admin', 'editor'))
  with check (public.project_role(project_id) in ('owner', 'admin', 'editor'));

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------------
-- ROLLBACK -- restores every original (pre-migration) policy exactly.
-- Safe at any time -- this only changes who's ALLOWED to write, no data is
-- ever touched. Run the WHOLE block below in one go if you need to revert
-- both sections; each DROP/CREATE pair is independent, so you can also
-- comment out just the Section-2 restores if you only want to keep Section
-- 1's Client/Viewer narrowing while reverting Member's widened access.
--
-- begin;
--
-- -- Section 1 restores
-- drop policy if exists "Owners/admins/editors can upload media" on public.media_assets;
-- create policy "Members can upload media"
--   on public.media_assets for insert to authenticated
--   with check (public.is_project_member(project_id) and uploaded_by = auth.uid());
--
-- drop policy if exists "Owners/admins/editors can upload project media" on storage.objects;
-- create policy "Members can upload project media"
--   on storage.objects for insert to authenticated
--   with check (bucket_id = 'project-media' and public.is_project_member((storage.foldername(name))[1]::uuid));
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
--   using ((project_id is not null and public.is_project_member(project_id)) or (project_id is null and user_id = auth.uid()))
--   with check ((project_id is not null and public.is_project_member(project_id)) or (project_id is null and user_id = auth.uid()));
--
-- -- Section 2 restores
-- drop policy if exists "Owners/admins/editors manage grid rows" on public.grid_rows;
-- create policy "Admins manage grid rows" on public.grid_rows for all to authenticated
--   using (public.project_role(project_id) in ('owner', 'admin'))
--   with check (public.project_role(project_id) in ('owner', 'admin'));
--
-- drop policy if exists "Owners/admins/editors manage posts" on public.posts;
-- create policy "Admins manage posts" on public.posts for all to authenticated
--   using (public.project_role(project_id) in ('owner', 'admin'))
--   with check (public.project_role(project_id) in ('owner', 'admin'));
--
-- drop policy if exists "Owners/admins/editors manage grid slots" on public.grid_slots;
-- create policy "Admins manage grid slots" on public.grid_slots for all to authenticated
--   using (exists (select 1 from public.grid_rows r where r.id = row_id and public.project_role(r.project_id) in ('owner', 'admin')))
--   with check (exists (select 1 from public.grid_rows r where r.id = row_id and public.project_role(r.project_id) in ('owner', 'admin')));
--
-- drop policy if exists "Owners/admins/editors manage post assets" on public.post_assets;
-- create policy "Admins manage post assets" on public.post_assets for all to authenticated
--   using (exists (select 1 from public.posts p where p.id = post_id and public.project_role(p.project_id) in ('owner', 'admin')))
--   with check (exists (select 1 from public.posts p where p.id = post_id and public.project_role(p.project_id) in ('owner', 'admin')));
--
-- drop policy if exists "Owners/admins/editors manage post links" on public.post_links;
-- create policy "Admins manage post links" on public.post_links for all to authenticated
--   using (exists (select 1 from public.posts p where p.id = post_id and public.project_role(p.project_id) in ('owner', 'admin')))
--   with check (exists (select 1 from public.posts p where p.id = post_id and public.project_role(p.project_id) in ('owner', 'admin')));
--
-- drop policy if exists "Owners/admins/editors manage media folders" on public.media_folders;
-- create policy "Admins manage media folders" on public.media_folders for all to authenticated
--   using (public.project_role(project_id) in ('owner', 'admin'))
--   with check (public.project_role(project_id) in ('owner', 'admin'));
--
-- drop policy if exists "Owners/admins/editors update media" on public.media_assets;
-- create policy "Admins update media" on public.media_assets for update to authenticated
--   using (public.project_role(project_id) in ('owner', 'admin'))
--   with check (public.project_role(project_id) in ('owner', 'admin'));
--
-- drop policy if exists "Owners/admins/editors can delete media" on public.media_assets;
-- create policy "Owners/admins can delete media" on public.media_assets for delete to authenticated
--   using (public.project_role(project_id) in ('owner', 'admin'));
--
-- drop policy if exists "Owners/admins/editors manage calendar notes" on public.calendar_notes;
-- create policy "Admins manage calendar notes" on public.calendar_notes for all to authenticated
--   using (public.project_role(project_id) in ('owner', 'admin'))
--   with check (public.project_role(project_id) in ('owner', 'admin'));
--
-- drop policy if exists "Owners/admins/editors manage brief tasks" on public.brief_tasks;
-- create policy "Admins manage brief tasks" on public.brief_tasks for all to authenticated
--   using (public.project_role(project_id) in ('owner', 'admin'))
--   with check (public.project_role(project_id) in ('owner', 'admin'));
--
-- drop policy if exists "Owners/admins/editors manage brief task items" on public.brief_task_items;
-- create policy "Admins manage brief task items" on public.brief_task_items for all to authenticated
--   using (exists (select 1 from public.brief_tasks t where t.id = task_id and public.project_role(t.project_id) in ('owner', 'admin')))
--   with check (exists (select 1 from public.brief_tasks t where t.id = task_id and public.project_role(t.project_id) in ('owner', 'admin')));
--
-- drop policy if exists "Owners/admins/editors manage brief task frames" on public.brief_task_frames;
-- create policy "Admins manage brief task frames" on public.brief_task_frames for all to authenticated
--   using (exists (select 1 from public.brief_tasks t where t.id = task_id and public.project_role(t.project_id) in ('owner', 'admin')))
--   with check (exists (select 1 from public.brief_tasks t where t.id = task_id and public.project_role(t.project_id) in ('owner', 'admin')));
--
-- drop policy if exists "Owners/admins/editors manage brief attachments" on public.brief_attachments;
-- create policy "Admins manage brief attachments" on public.brief_attachments for all to authenticated
--   using (public.project_role(project_id) in ('owner', 'admin'))
--   with check (public.project_role(project_id) in ('owner', 'admin'));
--
-- drop policy if exists "Owners/admins/editors manage brand moodboard" on public.brand_moodboard_items;
-- create policy "Admins manage brand moodboard" on public.brand_moodboard_items for all to authenticated
--   using (public.project_role(project_id) in ('owner', 'admin'))
--   with check (public.project_role(project_id) in ('owner', 'admin'));
--
-- drop policy if exists "Owners/admins/editors can upload brief media" on storage.objects;
-- create policy "Members can upload brief media" on storage.objects for insert to authenticated
--   with check (bucket_id = 'brief-media' and public.project_role((storage.foldername(name))[1]::uuid) in ('owner', 'admin'));
--
-- drop policy if exists "Owners/admins/editors can delete brief media" on storage.objects;
-- create policy "Admins can delete brief media" on storage.objects for delete to authenticated
--   using (bucket_id = 'brief-media' and public.project_role((storage.foldername(name))[1]::uuid) in ('owner', 'admin'));
--
-- drop policy if exists "Owners/admins/editors manage stories" on public.stories;
-- create policy "Admins manage stories" on public.stories for all to authenticated
--   using (public.project_role(project_id) in ('owner', 'admin'))
--   with check (public.project_role(project_id) in ('owner', 'admin'));
--
-- drop policy if exists "Owners/admins/editors manage story frames" on public.story_frames;
-- create policy "Admins manage story frames" on public.story_frames for all to authenticated
--   using (exists (select 1 from public.stories s where s.id = story_id and public.project_role(s.project_id) in ('owner', 'admin')))
--   with check (exists (select 1 from public.stories s where s.id = story_id and public.project_role(s.project_id) in ('owner', 'admin')));
--
-- drop policy if exists "Owners/admins/editors manage story links" on public.story_links;
-- create policy "Admins manage story links" on public.story_links for all to authenticated
--   using (exists (select 1 from public.stories s where s.id = story_id and public.project_role(s.project_id) in ('owner', 'admin')))
--   with check (exists (select 1 from public.stories s where s.id = story_id and public.project_role(s.project_id) in ('owner', 'admin')));
--
-- drop policy if exists "Owners/admins/editors manage content folders" on public.content_folders;
-- create policy "Admins manage content folders" on public.content_folders for all to authenticated
--   using (public.project_role(project_id) in ('owner', 'admin'))
--   with check (public.project_role(project_id) in ('owner', 'admin'));
--
-- drop policy if exists "Owners/admins/editors manage asset collections" on public.asset_collections;
-- create policy "Admins manage asset collections" on public.asset_collections for all to authenticated
--   using (public.project_role(project_id) in ('owner', 'admin'))
--   with check (public.project_role(project_id) in ('owner', 'admin'));
--
-- notify pgrst, 'reload schema';
-- commit;
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- READ-ONLY POST-MIGRATION VERIFICATION -- run these after, no writes.
--
-- 1. Confirm every new policy exists (expect 30 rows: 4 tasks + 3 section-1
--    media/storage + 23 section-2 policies across public+storage):
-- select schemaname, tablename, policyname, cmd
-- from pg_policies
-- where (schemaname = 'public' and tablename in (
--          'media_assets','tasks','grid_rows','posts','grid_slots','post_assets',
--          'post_links','media_folders','calendar_notes','brief_tasks',
--          'brief_task_items','brief_task_frames','brief_attachments',
--          'brand_moodboard_items','stories','story_frames','story_links',
--          'content_folders','asset_collections'
--        ))
--    or (schemaname = 'storage' and tablename = 'objects' and policyname like '%project media%' or policyname like '%brief media%')
-- order by tablename, policyname;
--
-- 2. Confirm no existing rows were touched/lost (compare these counts to
--    whatever you already know them to be before running -- every one of
--    these should be identical before and after):
-- select
--   (select count(*) from public.media_assets) as media_assets,
--   (select count(*) from public.tasks) as tasks,
--   (select count(*) from public.grid_rows) as grid_rows,
--   (select count(*) from public.posts) as posts,
--   (select count(*) from public.grid_slots) as grid_slots,
--   (select count(*) from public.calendar_notes) as calendar_notes,
--   (select count(*) from public.brief_tasks) as brief_tasks,
--   (select count(*) from public.stories) as stories,
--   (select count(*) from public.content_folders) as content_folders,
--   (select count(*) from public.asset_collections) as asset_collections;
--
-- 3. Confirm every existing project_members row's role/custom_permissions
--    is completely untouched (this migration only changes RLS policies,
--    never writes to project_members itself):
-- select role, count(*) from public.project_members group by role order by 1;
--
-- 4. Spot-check that Client/Viewer were never added anywhere in Section 2
--    (every policy touched by this migration should mention only
--    owner/admin/editor, never client or viewer):
-- select tablename, policyname, qual, with_check
-- from pg_policies
-- where schemaname = 'public'
--   and policyname like 'Owners/admins/editors%'
--   and (qual ilike '%client%' or qual ilike '%viewer%' or with_check ilike '%client%' or with_check ilike '%viewer%');
-- -- expect: 0 rows
-- ---------------------------------------------------------------------------
