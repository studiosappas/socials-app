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
-- Run this in the Supabase SQL editor. Transactional (one begin/commit
-- wraps the whole file -- all-or-nothing, no window with a mix of old/new
-- policies, and a failure anywhere rolls back everything, never leaving a
-- table with a weaker or missing policy). Genuinely safe to re-run: every
-- `create policy` is preceded by a `drop policy if exists` for BOTH the
-- name it's replacing AND its own target name, so a second run cleanly
-- recreates the same end state instead of erroring on "policy already
-- exists" (which a create-only idempotency check would hit, since Postgres
-- has no `create policy if not exists`). Purely additive-restrictive or
-- additive-permissive per policy -- no existing row's data, membership,
-- role, or custom_permissions is ever touched; this only changes who is
-- ALLOWED to write going forward.
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
drop policy if exists "Owners/admins/editors can upload media" on public.media_assets;
create policy "Owners/admins/editors can upload media"
  on public.media_assets for insert to authenticated
  with check (
    public.is_project_member(project_id)
    and public.project_role(project_id) in ('owner', 'admin', 'editor')
    and uploaded_by = auth.uid()
  );

-- ---------- project-media storage: upload/update restricted the same way ----------
drop policy if exists "Members can upload project media" on storage.objects;
drop policy if exists "Owners/admins/editors can upload project media" on storage.objects;
create policy "Owners/admins/editors can upload project media"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'project-media'
    and public.is_project_member((storage.foldername(name))[1]::uuid)
    and public.project_role((storage.foldername(name))[1]::uuid) in ('owner', 'admin', 'editor')
  );

drop policy if exists "Members can update project media" on storage.objects;
drop policy if exists "Owners/admins/editors can update project media" on storage.objects;
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
drop policy if exists "Members view project tasks, users view personal tasks" on public.tasks;
drop policy if exists "Owners/admins/editors manage project tasks, users manage personal tasks" on public.tasks;
drop policy if exists "Owners/admins/editors update project tasks, users update personal tasks" on public.tasks;
drop policy if exists "Owners/admins/editors delete project tasks, users delete personal tasks" on public.tasks;

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
drop policy if exists "Owners/admins/editors manage grid rows" on public.grid_rows;
create policy "Owners/admins/editors manage grid rows" on public.grid_rows for all to authenticated
  using (public.project_role(project_id) in ('owner', 'admin', 'editor'))
  with check (public.project_role(project_id) in ('owner', 'admin', 'editor'));

-- posts | ALL | before: owner/admin | after: owner/admin/editor
-- Creating/editing/deleting a post (placeMediaInSlot, updatePost,
-- deletePost, updatePostCoverTransform's crop save).
drop policy if exists "Admins manage posts" on public.posts;
drop policy if exists "Owners/admins/editors manage posts" on public.posts;
create policy "Owners/admins/editors manage posts" on public.posts for all to authenticated
  using (public.project_role(project_id) in ('owner', 'admin', 'editor'))
  with check (public.project_role(project_id) in ('owner', 'admin', 'editor'));

-- grid_slots | ALL | before: owner/admin | after: owner/admin/editor
-- Placing a post into a slot, and reorder_grid_slots' per-row UPDATE
-- (SECURITY INVOKER -- it runs as the caller and was silently no-op-ing
-- per row for a non-owner/admin caller under the old policy; this is what
-- makes Member's Grid drag-reorder actually take effect).
drop policy if exists "Admins manage grid slots" on public.grid_slots;
drop policy if exists "Owners/admins/editors manage grid slots" on public.grid_slots;
create policy "Owners/admins/editors manage grid slots" on public.grid_slots for all to authenticated
  using (exists (select 1 from public.grid_rows r where r.id = row_id and public.project_role(r.project_id) in ('owner', 'admin', 'editor')))
  with check (exists (select 1 from public.grid_rows r where r.id = row_id and public.project_role(r.project_id) in ('owner', 'admin', 'editor')));

-- post_assets | ALL | before: owner/admin | after: owner/admin/editor
-- Adding/removing/reordering a post's media assets.
drop policy if exists "Admins manage post assets" on public.post_assets;
drop policy if exists "Owners/admins/editors manage post assets" on public.post_assets;
create policy "Owners/admins/editors manage post assets" on public.post_assets for all to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id and public.project_role(p.project_id) in ('owner', 'admin', 'editor')))
  with check (exists (select 1 from public.posts p where p.id = post_id and public.project_role(p.project_id) in ('owner', 'admin', 'editor')));

-- post_links | ALL | before: owner/admin | after: owner/admin/editor
-- Adding/removing a post's link-out URLs.
drop policy if exists "Admins manage post links" on public.post_links;
drop policy if exists "Owners/admins/editors manage post links" on public.post_links;
create policy "Owners/admins/editors manage post links" on public.post_links for all to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id and public.project_role(p.project_id) in ('owner', 'admin', 'editor')))
  with check (exists (select 1 from public.posts p where p.id = post_id and public.project_role(p.project_id) in ('owner', 'admin', 'editor')));

-- media_folders | ALL | before: owner/admin | after: owner/admin/editor
-- Creating a folder in the Media Library (Grid's library sidebar).
drop policy if exists "Admins manage media folders" on public.media_folders;
drop policy if exists "Owners/admins/editors manage media folders" on public.media_folders;
create policy "Owners/admins/editors manage media folders" on public.media_folders for all
  to authenticated
  using (public.project_role(project_id) in ('owner', 'admin', 'editor'))
  with check (public.project_role(project_id) in ('owner', 'admin', 'editor'));

-- media_assets UPDATE | before: owner/admin | after: owner/admin/editor
-- Archiving/moving-to-folder an asset (deleteMedia's archive path,
-- moveMediaToFolder) -- this is the SAME "Admins update media" policy that
-- also governs annotation/crop saves and poster regeneration.
drop policy if exists "Admins update media" on public.media_assets;
drop policy if exists "Owners/admins/editors update media" on public.media_assets;
create policy "Owners/admins/editors update media"
  on public.media_assets for update
  to authenticated
  using (public.project_role(project_id) in ('owner', 'admin', 'editor'))
  with check (public.project_role(project_id) in ('owner', 'admin', 'editor'));

-- media_assets DELETE | before: owner/admin | after: owner/admin/editor
-- Hard-deleting a truly-unreferenced asset (deleteMedia/bulkDeleteMedia's
-- delete path, once nothing references it).
drop policy if exists "Owners/admins can delete media" on public.media_assets;
drop policy if exists "Owners/admins/editors can delete media" on public.media_assets;
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
drop policy if exists "Owners/admins/editors manage calendar notes" on public.calendar_notes;
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
drop policy if exists "Owners/admins/editors manage brief tasks" on public.brief_tasks;
create policy "Owners/admins/editors manage brief tasks" on public.brief_tasks for all to authenticated
  using (public.project_role(project_id) in ('owner', 'admin', 'editor'))
  with check (public.project_role(project_id) in ('owner', 'admin', 'editor'));

-- brief_task_items | ALL | before: owner/admin | after: owner/admin/editor
drop policy if exists "Admins manage brief task items" on public.brief_task_items;
drop policy if exists "Owners/admins/editors manage brief task items" on public.brief_task_items;
create policy "Owners/admins/editors manage brief task items" on public.brief_task_items for all to authenticated
  using (exists (select 1 from public.brief_tasks t where t.id = task_id and public.project_role(t.project_id) in ('owner', 'admin', 'editor')))
  with check (exists (select 1 from public.brief_tasks t where t.id = task_id and public.project_role(t.project_id) in ('owner', 'admin', 'editor')));

-- brief_task_frames | ALL | before: owner/admin | after: owner/admin/editor
drop policy if exists "Admins manage brief task frames" on public.brief_task_frames;
drop policy if exists "Owners/admins/editors manage brief task frames" on public.brief_task_frames;
create policy "Owners/admins/editors manage brief task frames" on public.brief_task_frames for all to authenticated
  using (exists (select 1 from public.brief_tasks t where t.id = task_id and public.project_role(t.project_id) in ('owner', 'admin', 'editor')))
  with check (exists (select 1 from public.brief_tasks t where t.id = task_id and public.project_role(t.project_id) in ('owner', 'admin', 'editor')));

-- brief_attachments | ALL | before: owner/admin | after: owner/admin/editor
drop policy if exists "Admins manage brief attachments" on public.brief_attachments;
drop policy if exists "Owners/admins/editors manage brief attachments" on public.brief_attachments;
create policy "Owners/admins/editors manage brief attachments" on public.brief_attachments for all to authenticated
  using (public.project_role(project_id) in ('owner', 'admin', 'editor'))
  with check (public.project_role(project_id) in ('owner', 'admin', 'editor'));

-- brand_moodboard_items | ALL | before: owner/admin | after: owner/admin/editor
drop policy if exists "Admins manage brand moodboard" on public.brand_moodboard_items;
drop policy if exists "Owners/admins/editors manage brand moodboard" on public.brand_moodboard_items;
create policy "Owners/admins/editors manage brand moodboard" on public.brand_moodboard_items for all to authenticated
  using (public.project_role(project_id) in ('owner', 'admin', 'editor'))
  with check (public.project_role(project_id) in ('owner', 'admin', 'editor'));

-- storage brief-media INSERT | before: owner/admin | after: owner/admin/editor
-- (existing policy name "Members can upload brief media" is misleading --
-- it was already owner/admin-only, not member-wide; renamed for clarity)
drop policy if exists "Members can upload brief media" on storage.objects;
drop policy if exists "Owners/admins/editors can upload brief media" on storage.objects;
create policy "Owners/admins/editors can upload brief media"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'brief-media'
    and public.project_role((storage.foldername(name))[1]::uuid) in ('owner', 'admin', 'editor')
  );

-- storage brief-media DELETE | before: owner/admin | after: owner/admin/editor
drop policy if exists "Admins can delete brief media" on storage.objects;
drop policy if exists "Owners/admins/editors can delete brief media" on storage.objects;
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
drop policy if exists "Owners/admins/editors manage stories" on public.stories;
create policy "Owners/admins/editors manage stories" on public.stories for all to authenticated
  using (public.project_role(project_id) in ('owner', 'admin', 'editor'))
  with check (public.project_role(project_id) in ('owner', 'admin', 'editor'));

-- story_frames | ALL | before: owner/admin | after: owner/admin/editor
drop policy if exists "Admins manage story frames" on public.story_frames;
drop policy if exists "Owners/admins/editors manage story frames" on public.story_frames;
create policy "Owners/admins/editors manage story frames" on public.story_frames for all to authenticated
  using (exists (select 1 from public.stories s where s.id = story_id and public.project_role(s.project_id) in ('owner', 'admin', 'editor')))
  with check (exists (select 1 from public.stories s where s.id = story_id and public.project_role(s.project_id) in ('owner', 'admin', 'editor')));

-- story_links | ALL | before: owner/admin | after: owner/admin/editor
drop policy if exists "Admins manage story links" on public.story_links;
drop policy if exists "Owners/admins/editors manage story links" on public.story_links;
create policy "Owners/admins/editors manage story links" on public.story_links for all to authenticated
  using (exists (select 1 from public.stories s where s.id = story_id and public.project_role(s.project_id) in ('owner', 'admin', 'editor')))
  with check (exists (select 1 from public.stories s where s.id = story_id and public.project_role(s.project_id) in ('owner', 'admin', 'editor')));

-- content_folders | ALL | before: owner/admin | after: owner/admin/editor
drop policy if exists "Admins manage content folders" on public.content_folders;
drop policy if exists "Owners/admins/editors manage content folders" on public.content_folders;
create policy "Owners/admins/editors manage content folders" on public.content_folders for all to authenticated
  using (public.project_role(project_id) in ('owner', 'admin', 'editor'))
  with check (public.project_role(project_id) in ('owner', 'admin', 'editor'));

-- ---------- Assets ----------
-- WHY: adding/editing/removing an asset collection entry is Member's
-- normal day-to-day Assets work.

-- asset_collections | ALL | before: owner/admin | after: owner/admin/editor
drop policy if exists "Admins manage asset collections" on public.asset_collections;
drop policy if exists "Owners/admins/editors manage asset collections" on public.asset_collections;
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
-- READ-ONLY PRE-MIGRATION COUNTS -- run this BEFORE the migration and keep
-- the result. Same shape as verification query #2 below, so the two are a
-- direct before/after diff -- every column should read identically both
-- times; if any pair differs, stop and do not treat the migration as clean.
--
-- select
--   (select count(*) from public.project_members) as project_members,
--   (select count(*) from public.media_assets) as media_assets,
--   (select count(*) from public.tasks) as tasks,
--   (select count(*) from public.grid_rows) as grid_rows,
--   (select count(*) from public.grid_slots) as grid_slots,
--   (select count(*) from public.posts) as posts,
--   (select count(*) from public.post_assets) as post_assets,
--   (select count(*) from public.post_links) as post_links,
--   (select count(*) from public.media_folders) as media_folders,
--   (select count(*) from public.calendar_notes) as calendar_notes,
--   (select count(*) from public.brief_tasks) as brief_tasks,
--   (select count(*) from public.brief_task_items) as brief_task_items,
--   (select count(*) from public.brief_task_frames) as brief_task_frames,
--   (select count(*) from public.brief_attachments) as brief_attachments,
--   (select count(*) from public.brand_moodboard_items) as brand_moodboard_items,
--   (select count(*) from public.stories) as stories,
--   (select count(*) from public.story_frames) as story_frames,
--   (select count(*) from public.story_links) as story_links,
--   (select count(*) from public.content_folders) as content_folders,
--   (select count(*) from public.asset_collections) as asset_collections;
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- READ-ONLY POST-MIGRATION VERIFICATION -- run this after, no writes.
--
-- Deliberately does NOT match by exact policy name. A policy's cosmetic
-- name is only an identifier for DROP/ALTER -- Postgres enforces access by
-- (table, command, qual/with_check), never by name, so a name-level typo
-- (one shipped in an earlier run of this exact migration: the tasks INSERT
-- policy landed as "...edititors..." instead of "...editors...") has zero
-- effect on actual enforcement but WOULD produce a false "missing" result
-- from a query that matches on the literal name string. This version
-- checks each expected (schema, table, command) slot for a policy that
-- exists AND whose qual/with_check text proves the right roles -- immune
-- to a name typo anywhere, here or in a table this specific incident
-- didn't happen to hit.
--
-- Grouped by product area for a compact, scannable result. `details` lists
-- every (table, command) checked in that area and its individual verdict,
-- so a `false` row is diagnosable without a follow-up query.
--
-- Every qual/with_check inspection below is coalesce()'d to '' before any
-- ilike check. Reason: a policy only ever populates ONE of qual/with_check
-- unless it's UPDATE or ALL -- INSERT policies leave qual NULL (no USING
-- clause is possible on INSERT), DELETE policies leave with_check NULL (no
-- WITH CHECK clause is possible on DELETE). An earlier version of this
-- query did `qual ilike '%client%' or with_check ilike '%client%' or ...`
-- directly on the raw (nullable) columns: for a NULL column, `ilike`
-- returns SQL NULL (not false), and `NULL or false` is NULL, not false --
-- so the whole forbidden-role OR-chain silently evaluated to NULL instead
-- of a clean false whenever the correct, expected clause was missing (by
-- design) on a single-clause policy. `NOT NULL` is NULL, and NULL inside
-- an `exists (... where ...)` excludes the row -- so this produced a false
-- "EXISTS BUT WRONG ROLE SET" on media_assets DELETE and tasks
-- INSERT/DELETE even though those policies were 100% correct (confirmed
-- against a live, unfiltered read of both tables' actual qual/with_check
-- text). Wrapping every column in `coalesce(x, '')` first guarantees the
-- ilike comparisons are always true/false, never NULL, so the OR-chain and
-- the exists() around it can never silently drop a correct policy.
--
-- If any `passed` column reads false, stop and do not continue to Preview QA.

with checks as (
  select * from (values
    ('Grid', 'public', 'grid_rows', 'ALL', true),
    ('Grid', 'public', 'posts', 'ALL', true),
    ('Grid', 'public', 'grid_slots', 'ALL', true),
    ('Grid', 'public', 'post_assets', 'ALL', true),
    ('Grid', 'public', 'post_links', 'ALL', true),
    ('Grid', 'public', 'media_folders', 'ALL', true),
    ('Grid', 'public', 'media_assets', 'INSERT', true),
    ('Grid', 'public', 'media_assets', 'UPDATE', true),
    ('Grid', 'public', 'media_assets', 'DELETE', true),
    ('Calendar', 'public', 'calendar_notes', 'ALL', true),
    ('Brief', 'public', 'brief_tasks', 'ALL', true),
    ('Brief', 'public', 'brief_task_items', 'ALL', true),
    ('Brief', 'public', 'brief_task_frames', 'ALL', true),
    ('Brief', 'public', 'brief_attachments', 'ALL', true),
    ('Brief', 'public', 'brand_moodboard_items', 'ALL', true),
    ('Content', 'public', 'stories', 'ALL', true),
    ('Content', 'public', 'story_frames', 'ALL', true),
    ('Content', 'public', 'story_links', 'ALL', true),
    ('Content', 'public', 'content_folders', 'ALL', true),
    ('Assets', 'public', 'asset_collections', 'ALL', true),
    ('Tasks', 'public', 'tasks', 'SELECT', false),
    ('Tasks', 'public', 'tasks', 'INSERT', true),
    ('Tasks', 'public', 'tasks', 'UPDATE', true),
    ('Tasks', 'public', 'tasks', 'DELETE', true)
  ) as t(area, schema_name, table_name, op, requires_editor)
),
per_check as (
  select
    c.area, c.table_name, c.op,
    exists (
      select 1 from pg_policies p
      where p.schemaname = c.schema_name and p.tablename = c.table_name and upper(p.cmd) = c.op
    ) as policy_exists,
    exists (
      select 1 from pg_policies p
      where p.schemaname = c.schema_name and p.tablename = c.table_name and upper(p.cmd) = c.op
        and (
          not c.requires_editor
          or (coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')) ilike '%editor%'
        )
        and (coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')) not ilike '%client%'
        and (coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')) not ilike '%viewer%'
        and (coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')) not ilike '%designer%'
    ) as policy_correct
  from checks c
)
select area as check_name,
  bool_and(policy_exists and policy_correct) as passed,
  string_agg(
    table_name || ' ' || op || ': ' ||
    case when not policy_exists then 'MISSING'
         when not policy_correct then 'EXISTS BUT WRONG ROLE SET'
         else 'ok' end,
    '; ' order by table_name, op
  ) as details
from per_check
group by area

union all

select 'storage_project_media' as check_name,
  (count(*) filter (where upper(cmd) in ('INSERT','UPDATE')) = 2
   and count(*) filter (where (coalesce(qual,'') || ' ' || coalesce(with_check,'')) not ilike '%editor%') = 0
   and count(*) filter (where (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ilike '%client%'
                          or (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ilike '%viewer%'
                          or (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ilike '%designer%') = 0
  ) as passed,
  string_agg(cmd || ': ' || policyname, '; ') as details
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and policyname ilike '%project media%' and upper(cmd) in ('INSERT','UPDATE')

union all

select 'storage_brief_media' as check_name,
  (count(*) filter (where upper(cmd) in ('INSERT','DELETE')) = 2
   and count(*) filter (where (coalesce(qual,'') || ' ' || coalesce(with_check,'')) not ilike '%editor%') = 0
   and count(*) filter (where (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ilike '%client%'
                          or (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ilike '%viewer%'
                          or (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ilike '%designer%') = 0
  ) as passed,
  string_agg(cmd || ': ' || policyname, '; ') as details
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and policyname ilike '%brief media%' and upper(cmd) in ('INSERT','DELETE')

union all

select 'project_members_unchanged' as check_name,
  (
    (
      select coalesce(qual, '') || ' ' || coalesce(with_check, '')
      from pg_policies
      where schemaname = 'public' and tablename = 'project_members' and policyname = 'Owners/admins can manage membership'
    ) ilike '%owner%admin%'
    and (
      select coalesce(qual, '') || ' ' || coalesce(with_check, '')
      from pg_policies
      where schemaname = 'public' and tablename = 'project_members' and policyname = 'Owners/admins can manage membership'
    ) not ilike '%editor%'
  ) as passed,
  'membership policy still owner/admin-only, no editor/client/viewer' as details

union all

select 'no_old_policy_names_remaining' as check_name,
  (count(*) = 0) as passed,
  count(*)::text || ' old (pre-migration) policy names still exist -- should be 0' as details
from (values
  ('public','media_assets','Members can upload media'),
  ('storage','objects','Members can upload project media'),
  ('storage','objects','Members can update project media'),
  ('public','tasks','Members manage project tasks, users manage personal tasks'),
  ('public','grid_rows','Admins manage grid rows'),
  ('public','posts','Admins manage posts'),
  ('public','grid_slots','Admins manage grid slots'),
  ('public','post_assets','Admins manage post assets'),
  ('public','post_links','Admins manage post links'),
  ('public','media_folders','Admins manage media folders'),
  ('public','media_assets','Admins update media'),
  ('public','media_assets','Owners/admins can delete media'),
  ('public','calendar_notes','Admins manage calendar notes'),
  ('public','brief_tasks','Admins manage brief tasks'),
  ('public','brief_task_items','Admins manage brief task items'),
  ('public','brief_task_frames','Admins manage brief task frames'),
  ('public','brief_attachments','Admins manage brief attachments'),
  ('public','brand_moodboard_items','Admins manage brand moodboard'),
  ('storage','objects','Members can upload brief media'),
  ('storage','objects','Admins can delete brief media'),
  ('public','stories','Admins manage stories'),
  ('public','story_frames','Admins manage story frames'),
  ('public','story_links','Admins manage story links'),
  ('public','content_folders','Admins manage content folders'),
  ('public','asset_collections','Admins manage asset collections')
) as o(schema_name, table_name, policy_name)
join pg_policies p on p.schemaname = o.schema_name and p.tablename = o.table_name and p.policyname = o.policy_name;

-- Row counts are checked separately -- run the PRE-MIGRATION COUNTS block
-- above and compare its output by eye against this one (no automatic
-- passed/failed here, since the baseline lives in your saved earlier
-- result, not in the database):
--
-- select
--   (select count(*) from public.project_members) as project_members,
--   (select count(*) from public.media_assets) as media_assets,
--   (select count(*) from public.tasks) as tasks,
--   (select count(*) from public.grid_rows) as grid_rows,
--   (select count(*) from public.grid_slots) as grid_slots,
--   (select count(*) from public.posts) as posts,
--   (select count(*) from public.post_assets) as post_assets,
--   (select count(*) from public.post_links) as post_links,
--   (select count(*) from public.media_folders) as media_folders,
--   (select count(*) from public.calendar_notes) as calendar_notes,
--   (select count(*) from public.brief_tasks) as brief_tasks,
--   (select count(*) from public.brief_task_items) as brief_task_items,
--   (select count(*) from public.brief_task_frames) as brief_task_frames,
--   (select count(*) from public.brief_attachments) as brief_attachments,
--   (select count(*) from public.brand_moodboard_items) as brand_moodboard_items,
--   (select count(*) from public.stories) as stories,
--   (select count(*) from public.story_frames) as story_frames,
--   (select count(*) from public.story_links) as story_links,
--   (select count(*) from public.content_folders) as content_folders,
--   (select count(*) from public.asset_collections) as asset_collections;
-- ---------------------------------------------------------------------------
