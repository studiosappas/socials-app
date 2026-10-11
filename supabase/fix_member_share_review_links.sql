-- Lets a Member (the 'editor' role) CREATE review links ("Share for
-- Review"), in addition to Owner/Admin.
--
-- Before this, share_links / share_link_items had exactly two policies each:
-- a member-wide SELECT, and an owner/admin-only FOR ALL. fix_project_role_
-- permission_presets.sql deliberately left sharing owner/admin-only, but the
-- app offered "Share for Review" to every role anyway -- a Member could pick
-- content and then hit a raw row-level-security error on confirm. The
-- product decision is now that Members may create review links.
--
-- What this adds (and nothing else):
--   1. share_links INSERT for owner/admin/editor, only as yourself
--      (created_by = auth.uid()).
--   2. share_link_items INSERT for owner/admin/editor, only into a link YOU
--      created, and only for a post/story that belongs to that link's OWN
--      project (get_shared_preview is SECURITY DEFINER, so an item pointing
--      at another project's post would expose it to anyone with the link).
--   3. share_links DELETE of a link YOU created, for owner/admin/editor --
--      needed so a failed create can clean up its own empty link (the app's
--      existing rollback), and lets a Member remove a link they made by
--      mistake.
--
-- What this deliberately does NOT do:
--   - Viewer, Client and legacy 'designer' get nothing new -- still SELECT
--     only.
--   - A Member cannot UPDATE any link, and cannot DELETE or otherwise manage
--     a link somebody else created. Managing every link in a project stays
--     owner/admin-only, through the two existing "Admins manage ..." FOR ALL
--     policies, which this file does not touch.
--   - The existing SELECT policies, get_shared_preview, the *_by_token
--     review functions and the storage policy for shared media are all
--     untouched -- public review access works exactly as before.
--
-- Run this in the Supabase SQL editor. Transactional and safe to re-run
-- (every create policy is preceded by a drop policy if exists for its own
-- name). Purely additive-permissive: no existing row is touched.
--
-- Rollback: drop the three policies created below.

begin;

drop policy if exists "Editors can create share links" on public.share_links;
create policy "Editors can create share links" on public.share_links for insert to authenticated
  with check (
    created_by = auth.uid()
    and public.project_role(project_id) in ('owner', 'admin', 'editor')
  );

drop policy if exists "Creators can delete own share links" on public.share_links;
create policy "Creators can delete own share links" on public.share_links for delete to authenticated
  using (
    created_by = auth.uid()
    and public.project_role(project_id) in ('owner', 'admin', 'editor')
  );

drop policy if exists "Creators can add items to own share links" on public.share_link_items;
create policy "Creators can add items to own share links" on public.share_link_items for insert to authenticated
  with check (exists (
    select 1 from public.share_links sl
    where sl.id = share_link_id
      and sl.created_by = auth.uid()
      and public.project_role(sl.project_id) in ('owner', 'admin', 'editor')
      and (post_id is null or exists (
        select 1 from public.posts p where p.id = post_id and p.project_id = sl.project_id
      ))
      and (story_id is null or exists (
        select 1 from public.stories s where s.id = story_id and s.project_id = sl.project_id
      ))
  ));

commit;
