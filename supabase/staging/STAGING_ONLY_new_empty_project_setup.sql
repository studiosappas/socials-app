-- ============================================================================
--  FLOW:ER  --  STAGING ONLY  --  NEW, EMPTY SUPABASE PROJECT SETUP
-- ============================================================================
--
--  THIS IS NOT A MIGRATION.  DO NOT RUN IT ON PRODUCTION.
--
--  What it is: the complete one-time setup for a BRAND-NEW, EMPTY Supabase
--  project that will be Flow:er's Staging database ("flower-STAGING").
--  It creates every table, permission rule, function and storage bucket the
--  app needs. It contains no customer data, no users and no secrets.
--
--  How to use it:
--    1. In Supabase, check the project name at the top of the page says
--       flower-STAGING.
--    2. SQL Editor -> New query -> paste this WHOLE file -> Run.
--    3. The result is one row starting "STAGING SETUP COMPLETE".
--
--  Safety built in:
--    - The first step checks the database is EMPTY (no app tables, no users,
--      no storage buckets). If it is not -- for example because this was
--      pasted into Production by mistake -- it stops with an error and
--      changes NOTHING.
--    - Everything after that runs as ONE transaction: if any step fails,
--      the whole setup is undone and the database is left empty again.
--    - It can only ever succeed once per project. A second run is refused by
--      the same empty-database check.
--
--  To start over: delete the Staging project in Supabase and create a new one.
--
--  NOT included, on purpose:
--    - fix_member_share_review_links.sql (the Member review-link permission).
--      It is applied to Staging separately, as part of testing that fix.
--    - RUN_ALL_PENDING_MIGRATIONS.sql and the other older fix_*.sql files.
--      They are either already contained in schema.sql or would put back
--      older, broader permissions. Do not run them on Staging afterwards.
--
--  GENERATED FILE -- do not edit by hand. It is built from the files named in
--  each section below by scripts/staging-db-setup.check.mjs, which also
--  rehearses it on a disposable local database and fails if this file no
--  longer matches its sources.
-- ============================================================================

-- ----------------------------------------------------------------------------
--  STEP 0 -- SAFETY CHECK: refuse to run on anything but an empty project.
--  (Outside the transaction on purpose: if it stops here, nothing was started.)
-- ----------------------------------------------------------------------------
do $staging_guard$
declare
  v_tables int;
  v_users int;
  v_buckets int;
begin
  select count(*) into v_tables
  from information_schema.tables
  where table_schema = 'public' and table_type = 'BASE TABLE';
  select count(*) into v_users from auth.users;
  select count(*) into v_buckets from storage.buckets;

  if v_tables > 0 or v_users > 0 or v_buckets > 0 then
    raise exception
      'STOPPED - NOTHING WAS CHANGED. This database is not empty (% app tables, % users, % storage buckets). This script is ONLY for a brand-new, empty Flow:er STAGING project. If this is Production, close this tab. If this is Staging and you want to start over, delete the Staging project and create a new one.',
      v_tables, v_users, v_buckets;
  end if;
end
$staging_guard$;

begin;

-- ============================================================================
--  PART 1 of 5 -- schema.sql
--  the full base schema: tables, row-level security, functions, storage buckets
--  (copied as-is from supabase/schema.sql)
-- ============================================================================

-- Social Content Planner schema + RLS policies
-- Run this in the Supabase SQL editor for your project.

create extension if not exists "pgcrypto";

-- ---------- Profiles ----------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null,
  avatar_url text,
  -- Synced from auth.users at signup (see handle_new_user below) since
  -- auth.users itself isn't queryable through PostgREST -- this is what lets
  -- Settings > Project Information show "Owner Email" without a service-role RPC.
  email text,
  -- Global (not per-project) admin flag -- gates the Landing Demo Content
  -- Manager only. Every other authorization check in this app is per-project
  -- (project_members.role); this is the one exception, introduced because
  -- editing the public marketing page's demo content isn't scoped to any
  -- one project.
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Profiles are viewable by any authenticated user"
  on public.profiles for select
  to authenticated
  using (true);

create policy "Users can update their own profile"
  on public.profiles for update
  to authenticated
  using (id = auth.uid());

create policy "Users can insert their own profile"
  on public.profiles for insert
  to authenticated
  with check (id = auth.uid());

-- Auto-create a profile row when a new auth user signs up.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)), new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------- Projects & membership ----------
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  brand_notes text not null default '',
  platform text not null default 'instagram' check (platform in ('instagram', 'tiktok', 'pinterest', 'youtube')),
  ig_username text not null default '',
  ig_display_name text not null default '',
  ig_bio text not null default '',
  ig_posts_count integer not null default 0,
  ig_followers_count integer not null default 0,
  ig_following_count integer not null default 0,
  ig_website_link text not null default '',
  ig_handle text not null default '',
  instagram_url text not null default '',
  tiktok_url text not null default '',
  content_pillars text not null default '',
  industry text not null default '',
  posts_per_week smallint not null default 0,
  stories_per_week smallint not null default 0,
  reels_per_week smallint not null default 0,
  newsletter_per_week smallint not null default 0,
  profile_photo_path text,
  logo_storage_path text,
  brand_image_storage_path text,
  show_scheduled_dates boolean not null default true,
  -- Hidden from the main projects list but never deleted -- distinct from
  -- Danger Zone's "Delete Project", which is destructive/permanent.
  archived boolean not null default false,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

-- 'designer' is a legacy value kept for existing rows/RLS compatibility --
-- new invites use 'editor' instead (Settings > Team & Permissions' 5-role set).
create type public.project_role as enum ('owner', 'admin', 'designer', 'editor', 'viewer', 'client');

create table public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.project_role not null default 'editor',
  -- null = use the role's default access; a non-null array of page keys
  -- (overview/grid/stories/calendar/brief/settings) is a per-member override,
  -- set from Settings > Team & Permissions' "Custom Permissions" checklist.
  custom_permissions text[],
  notification_prefs jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

-- Helper: is the current user a member of a project, and with what role.
create function public.is_project_member(p_project_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.project_members
    where project_id = p_project_id and user_id = auth.uid()
  );
$$;

create function public.project_role(p_project_id uuid)
returns public.project_role
language sql
security definer
stable
as $$
  select role from public.project_members
  where project_id = p_project_id and user_id = auth.uid();
$$;

alter table public.projects enable row level security;
alter table public.project_members enable row level security;

create policy "Members can view their projects"
  on public.projects for select
  to authenticated
  using (public.is_project_member(id) or created_by = auth.uid());

create policy "Authenticated users can create projects"
  on public.projects for insert
  to authenticated
  with check (created_by = auth.uid());

create policy "Owners/admins can update their project"
  on public.projects for update
  to authenticated
  using (public.project_role(id) in ('owner', 'admin'));

create policy "Owners can delete their project"
  on public.projects for delete
  to authenticated
  using (public.project_role(id) = 'owner');

create policy "Members can view project membership"
  on public.project_members for select
  to authenticated
  using (public.is_project_member(project_id));

create policy "Owners/admins can manage membership"
  on public.project_members for all
  to authenticated
  using (public.project_role(project_id) in ('owner', 'admin'))
  with check (public.project_role(project_id) in ('owner', 'admin'));

-- The creator of a project is auto-added as its owner.
create function public.handle_new_project()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.project_members (project_id, user_id, role)
  values (new.id, new.created_by, 'owner');
  return new;
end;
$$;

create trigger on_project_created
  after insert on public.projects
  for each row execute procedure public.handle_new_project();

-- Lets an owner/admin resolve a teammate's user id from their email to invite them.
-- Only returns the id (no other user data), so the info leak is limited to "an account with this email exists".
create function public.get_user_id_by_email(p_email text)
returns uuid
language sql
security definer
stable
as $$
  select id from auth.users where email = p_email;
$$;

revoke all on function public.get_user_id_by_email(text) from public;
grant execute on function public.get_user_id_by_email(text) to authenticated;

-- ---------- Grid sidebar: flexible custom sections (beyond Notes/Content Pillars) ----------
create table public.project_sections (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null default '',
  body text not null default '',
  position integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.project_sections enable row level security;

create policy "Members can view project sections" on public.project_sections for select to authenticated
  using (public.is_project_member(project_id));
create policy "Admins manage project sections" on public.project_sections for all to authenticated
  using (public.project_role(project_id) in ('owner', 'admin'))
  with check (public.project_role(project_id) in ('owner', 'admin'));

-- ---------- Media library ----------
create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  storage_path text not null,
  media_type text not null default 'image' check (media_type in ('image', 'video', 'pdf')),
  uploaded_by uuid not null references public.profiles (id),
  -- Same original/preview/annotation_json pattern as brief_attachments:
  -- storage_path is the untouched original; preview_storage_path is the
  -- flattened annotated version shown wherever this asset is displayed
  -- (falls back to storage_path when null); annotation_json restores the
  -- editable Fabric object state across sessions.
  preview_storage_path text,
  annotation_json jsonb,
  -- Static first-frame capture for video assets (generated client-side at
  -- upload time), so Grid can show a poster image instead of ever mounting
  -- a <video> element for its cover -- null for images, and null for videos
  -- uploaded before this column existed.
  poster_storage_path text,
  -- A small generated JPEG for on-screen thumbnails (Grid tiles, the Media
  -- Library sidebar) -- distinct from preview_storage_path (an edited/
  -- annotated flatten, still full-size) and poster_storage_path (a video's
  -- cover frame). Null for anything uploaded before this existed; every
  -- read site falls back to the full original in that case.
  thumbnail_storage_path text,
  -- True only for a design created by Brief's "Generate Design" -- purely
  -- cosmetic (a small badge in Media Library), never gates anything: a
  -- generated asset is edited/saved/used exactly like a manual upload the
  -- instant it exists.
  generated_by_ai boolean not null default false,
  -- True once "deleted" from the Media Library while still referenced by at
  -- least one post_assets/story_frames row -- hides it from the library
  -- picker without touching the row or its storage file, so posts already
  -- using it keep working. A truly unused asset (zero references) is still
  -- actually deleted, never just archived. See deleteMedia/bulkDeleteMedia.
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.media_assets enable row level security;

create policy "Members can view media"
  on public.media_assets for select
  to authenticated
  using (public.is_project_member(project_id));

create policy "Members can upload media"
  on public.media_assets for insert
  to authenticated
  with check (public.is_project_member(project_id) and uploaded_by = auth.uid());

create policy "Admins update media"
  on public.media_assets for update
  to authenticated
  using (public.project_role(project_id) in ('owner', 'admin'))
  with check (public.project_role(project_id) in ('owner', 'admin'));

create policy "Owners/admins can delete media"
  on public.media_assets for delete
  to authenticated
  using (public.project_role(project_id) in ('owner', 'admin'));

-- ---------- Media folders ----------
create table public.media_folders (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

alter table public.media_assets add column folder_id uuid references public.media_folders (id) on delete set null;

alter table public.media_folders enable row level security;

create policy "Members can view media folders"
  on public.media_folders for select
  to authenticated
  using (public.is_project_member(project_id));

create policy "Admins manage media folders"
  on public.media_folders for all
  to authenticated
  using (public.project_role(project_id) in ('owner', 'admin'))
  with check (public.project_role(project_id) in ('owner', 'admin'));

-- ---------- Feed grid ----------
create table public.grid_rows (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  position integer not null,
  created_at timestamptz not null default now()
);

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  post_type text not null default 'post' check (post_type in ('post', 'reel', 'carousel')),
  caption text not null default '',
  notes text not null default '',
  scheduled_date date,
  scheduled_time time,
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'published', 'in_review')),
  -- Crop/pan/zoom for the post's cover (its first carousel asset), keyed by
  -- the post itself rather than whatever grid_slots cell it happens to be
  -- sitting in right now -- so moving a post to a different cell keeps its
  -- crop. (grid_slots.cover_transform below is the old, cell-keyed location
  -- this replaced; left in place, unused, rather than dropped.)
  cover_transform jsonb,
  created_at timestamptz not null default now()
);

create table public.grid_slots (
  id uuid primary key default gen_random_uuid(),
  row_id uuid not null references public.grid_rows (id) on delete cascade,
  position integer not null check (position between 0 and 2),
  post_id uuid references public.posts (id) on delete set null,
  -- Deprecated: crop now lives on posts.cover_transform (see above) so it
  -- follows the post when moved between cells. Column kept, unused, rather
  -- than dropped, to avoid a migration that could strand data.
  cover_transform jsonb,
  unique (row_id, position)
);

-- A post can only ever occupy one grid slot at a time. Deferred so a swap
-- between two slots (each briefly holding the other's post_id mid-batch)
-- doesn't trip the constraint until the whole transaction commits.
alter table public.grid_slots
  add constraint grid_slots_post_id_unique unique (post_id) deferrable initially deferred;

create table public.post_assets (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  media_asset_id uuid not null references public.media_assets (id) on delete cascade,
  position integer not null default 0
);

create table public.post_links (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  url text not null,
  label text not null default ''
);

alter table public.grid_rows enable row level security;
alter table public.posts enable row level security;
alter table public.grid_slots enable row level security;
alter table public.post_assets enable row level security;
alter table public.post_links enable row level security;

create policy "Members can view grid rows" on public.grid_rows for select to authenticated using (public.is_project_member(project_id));
create policy "Admins manage grid rows" on public.grid_rows for all to authenticated
  using (public.project_role(project_id) in ('owner', 'admin'))
  with check (public.project_role(project_id) in ('owner', 'admin'));

create policy "Members can view posts" on public.posts for select to authenticated using (public.is_project_member(project_id));
create policy "Admins manage posts" on public.posts for all to authenticated
  using (public.project_role(project_id) in ('owner', 'admin'))
  with check (public.project_role(project_id) in ('owner', 'admin'));

create policy "Members can view grid slots" on public.grid_slots for select to authenticated
  using (exists (select 1 from public.grid_rows r where r.id = row_id and public.is_project_member(r.project_id)));
create policy "Admins manage grid slots" on public.grid_slots for all to authenticated
  using (exists (select 1 from public.grid_rows r where r.id = row_id and public.project_role(r.project_id) in ('owner', 'admin')))
  with check (exists (select 1 from public.grid_rows r where r.id = row_id and public.project_role(r.project_id) in ('owner', 'admin')));

-- Reassigns every changed grid slot's post_id in a single transaction so a
-- concurrent read can never observe a post assigned to two slots at once.
create or replace function public.reorder_grid_slots(updates jsonb)
returns void
language plpgsql
security invoker
as $$
declare
  u jsonb;
begin
  for u in select * from jsonb_array_elements(updates) loop
    update public.grid_slots
    set post_id = (u->>'postId')::uuid
    where id = (u->>'slotId')::uuid;
  end loop;
end;
$$;

create policy "Members can view post assets" on public.post_assets for select to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id and public.is_project_member(p.project_id)));
create policy "Admins manage post assets" on public.post_assets for all to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id and public.project_role(p.project_id) in ('owner', 'admin')))
  with check (exists (select 1 from public.posts p where p.id = post_id and public.project_role(p.project_id) in ('owner', 'admin')));

create policy "Members can view post links" on public.post_links for select to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id and public.is_project_member(p.project_id)));
create policy "Admins manage post links" on public.post_links for all to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id and public.project_role(p.project_id) in ('owner', 'admin')))
  with check (exists (select 1 from public.posts p where p.id = post_id and public.project_role(p.project_id) in ('owner', 'admin')));

-- ---------- Calendar notes ----------
create table public.calendar_notes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  date date not null,
  body text not null default '',
  created_at timestamptz not null default now()
);

alter table public.calendar_notes enable row level security;

create policy "Members can view calendar notes" on public.calendar_notes for select to authenticated
  using (public.is_project_member(project_id));
create policy "Admins manage calendar notes" on public.calendar_notes for all to authenticated
  using (public.project_role(project_id) in ('owner', 'admin'))
  with check (public.project_role(project_id) in ('owner', 'admin'));

-- ---------- Stories ----------
create table public.stories (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null default '',
  scheduled_date date,
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'published')),
  notes text not null default '',
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.story_links (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references public.stories (id) on delete cascade,
  url text not null,
  label text not null default ''
);

create table public.story_frames (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references public.stories (id) on delete cascade,
  position integer not null default 0,
  media_asset_id uuid references public.media_assets (id) on delete set null,
  link_url text
);

alter table public.stories enable row level security;
alter table public.story_frames enable row level security;
alter table public.story_links enable row level security;

create policy "Members can view stories" on public.stories for select to authenticated using (public.is_project_member(project_id));
create policy "Admins manage stories" on public.stories for all to authenticated
  using (public.project_role(project_id) in ('owner', 'admin'))
  with check (public.project_role(project_id) in ('owner', 'admin'));

create policy "Members can view story frames" on public.story_frames for select to authenticated
  using (exists (select 1 from public.stories s where s.id = story_id and public.is_project_member(s.project_id)));
create policy "Admins manage story frames" on public.story_frames for all to authenticated
  using (exists (select 1 from public.stories s where s.id = story_id and public.project_role(s.project_id) in ('owner', 'admin')))
  with check (exists (select 1 from public.stories s where s.id = story_id and public.project_role(s.project_id) in ('owner', 'admin')));

create policy "Members can view story links" on public.story_links for select to authenticated
  using (exists (select 1 from public.stories s where s.id = story_id and public.is_project_member(s.project_id)));
create policy "Admins manage story links" on public.story_links for all to authenticated
  using (exists (select 1 from public.stories s where s.id = story_id and public.project_role(s.project_id) in ('owner', 'admin')))
  with check (exists (select 1 from public.stories s where s.id = story_id and public.project_role(s.project_id) in ('owner', 'admin')));

-- ---------- Design tasks ----------
create table public.design_task_templates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null,
  body_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.design_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  template_id uuid references public.design_task_templates (id) on delete set null,
  title text not null,
  body_json jsonb not null default '{}'::jsonb,
  assigned_to uuid references public.profiles (id),
  status text not null default 'open' check (status in ('open', 'in_progress', 'done')),
  created_at timestamptz not null default now()
);

create table public.design_task_links (
  id uuid primary key default gen_random_uuid(),
  design_task_id uuid not null references public.design_tasks (id) on delete cascade,
  url text not null,
  label text not null default ''
);

create table public.design_task_assets (
  id uuid primary key default gen_random_uuid(),
  design_task_id uuid not null references public.design_tasks (id) on delete cascade,
  media_asset_id uuid not null references public.media_assets (id) on delete cascade
);

alter table public.design_task_templates enable row level security;
alter table public.design_tasks enable row level security;
alter table public.design_task_links enable row level security;
alter table public.design_task_assets enable row level security;

create policy "Members can view templates" on public.design_task_templates for select to authenticated using (public.is_project_member(project_id));
create policy "Admins manage templates" on public.design_task_templates for all to authenticated
  using (public.project_role(project_id) in ('owner', 'admin'))
  with check (public.project_role(project_id) in ('owner', 'admin'));

create policy "Members can view design tasks" on public.design_tasks for select to authenticated using (public.is_project_member(project_id));
create policy "Admins manage design tasks" on public.design_tasks for insert to authenticated
  with check (public.project_role(project_id) in ('owner', 'admin'));
create policy "Admins can delete design tasks" on public.design_tasks for delete to authenticated
  using (public.project_role(project_id) in ('owner', 'admin'));
create policy "Admins or assignee can update design tasks" on public.design_tasks for update to authenticated
  using (public.project_role(project_id) in ('owner', 'admin') or assigned_to = auth.uid());

create policy "Members can view design task links" on public.design_task_links for select to authenticated
  using (exists (select 1 from public.design_tasks t where t.id = design_task_id and public.is_project_member(t.project_id)));
create policy "Admins manage design task links" on public.design_task_links for all to authenticated
  using (exists (select 1 from public.design_tasks t where t.id = design_task_id and public.project_role(t.project_id) in ('owner', 'admin')))
  with check (exists (select 1 from public.design_tasks t where t.id = design_task_id and public.project_role(t.project_id) in ('owner', 'admin')));

create policy "Members can view design task assets" on public.design_task_assets for select to authenticated
  using (exists (select 1 from public.design_tasks t where t.id = design_task_id and public.is_project_member(t.project_id)));
create policy "Admins manage design task assets" on public.design_task_assets for all to authenticated
  using (exists (select 1 from public.design_tasks t where t.id = design_task_id and public.project_role(t.project_id) in ('owner', 'admin')))
  with check (exists (select 1 from public.design_tasks t where t.id = design_task_id and public.project_role(t.project_id) in ('owner', 'admin')));

-- ---------- Brief (deprecated free-text doc; superseded by the structured
-- brief_tasks/brief_task_items/brief_task_frames model below) ----------
create table public.project_briefs (
  project_id uuid primary key references public.projects (id) on delete cascade,
  body_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.project_briefs enable row level security;

create policy "Members can view brief" on public.project_briefs for select to authenticated
  using (public.is_project_member(project_id));
create policy "Admins manage brief" on public.project_briefs for all to authenticated
  using (public.project_role(project_id) in ('owner', 'admin'))
  with check (public.project_role(project_id) in ('owner', 'admin'));

-- ---------- Brief v2: structured per-task content briefs ----------
create table public.brief_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null default 'Task',
  content_types text[] not null default array['story'],
  position int not null default 0,
  created_at timestamptz not null default now()
);

-- ---------- Brief image attachments (original preserved separately from annotations) ----------
-- Defined HERE, ahead of brief_task_items, because brief_task_items.attachment_id
-- references it. (It used to sit further down, after the tasks tables, which
-- made this file fail on an empty database: the reference pointed at a table
-- that didn't exist yet.) Moved as-is -- definition and policies unchanged.
create table public.brief_attachments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  original_storage_path text not null,
  preview_storage_path text,
  annotation_json jsonb,
  created_at timestamptz not null default now()
);

alter table public.brief_attachments enable row level security;

create policy "Members can view brief attachments" on public.brief_attachments for select to authenticated
  using (public.is_project_member(project_id));
create policy "Admins manage brief attachments" on public.brief_attachments for all to authenticated
  using (public.project_role(project_id) in ('owner', 'admin'))
  with check (public.project_role(project_id) in ('owner', 'admin'));

create table public.brief_task_items (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.brief_tasks (id) on delete cascade,
  section text not null check (section in ('references', 'images', 'products')),
  kind text not null check (kind in ('link', 'image')),
  url text,
  label text not null default '',
  notes text not null default '',
  attachment_id uuid references public.brief_attachments (id) on delete set null,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create table public.brief_task_frames (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.brief_tasks (id) on delete cascade,
  section text not null check (section in ('frames', 'text')),
  label text not null,
  body text not null default '',
  position int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.brief_tasks enable row level security;
alter table public.brief_task_items enable row level security;
alter table public.brief_task_frames enable row level security;

create policy "Members can view brief tasks" on public.brief_tasks for select to authenticated
  using (public.is_project_member(project_id));
create policy "Admins manage brief tasks" on public.brief_tasks for all to authenticated
  using (public.project_role(project_id) in ('owner', 'admin'))
  with check (public.project_role(project_id) in ('owner', 'admin'));

create policy "Members can view brief task items" on public.brief_task_items for select to authenticated
  using (exists (select 1 from public.brief_tasks t where t.id = task_id and public.is_project_member(t.project_id)));
create policy "Admins manage brief task items" on public.brief_task_items for all to authenticated
  using (exists (select 1 from public.brief_tasks t where t.id = task_id and public.project_role(t.project_id) in ('owner', 'admin')))
  with check (exists (select 1 from public.brief_tasks t where t.id = task_id and public.project_role(t.project_id) in ('owner', 'admin')));

create policy "Members can view brief task frames" on public.brief_task_frames for select to authenticated
  using (exists (select 1 from public.brief_tasks t where t.id = task_id and public.is_project_member(t.project_id)));
create policy "Admins manage brief task frames" on public.brief_task_frames for all to authenticated
  using (exists (select 1 from public.brief_tasks t where t.id = task_id and public.project_role(t.project_id) in ('owner', 'admin')))
  with check (exists (select 1 from public.brief_tasks t where t.id = task_id and public.project_role(t.project_id) in ('owner', 'admin')));

-- ---------- Brand strategy & knowledge base ----------
create table public.brand_strategy (
  project_id uuid primary key references public.projects (id) on delete cascade,
  brand_values text not null default '',
  vision text not null default '',
  voice text not null default '',
  positioning text not null default '',
  audience_notes text not null default '',
  ai_summary text not null default '',
  ai_brand_dna text not null default '',
  ai_tone_of_voice text not null default '',
  ai_communication_style text not null default '',
  ai_content_pillars text not null default '',
  ai_audience_snapshot text not null default '',
  ai_visual_language text not null default '',
  ai_avoid text not null default '',
  ai_insights jsonb,
  ai_insights_updated_at timestamptz,
  spectrum_serious_playful smallint not null default 50,
  spectrum_classic_futuristic smallint not null default 50,
  spectrum_premium_accessible smallint not null default 50,
  spectrum_editorial_commercial smallint not null default 50,
  spectrum_minimal_expressive smallint not null default 50,
  spectrum_luxury_casual smallint not null default 50,
  updated_at timestamptz not null default now()
);

create table public.brand_documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  source_type text not null default 'file' check (source_type in ('file', 'link')),
  storage_path text,
  url text,
  filename text not null,
  uploaded_by uuid not null references public.profiles (id),
  ai_analysis text not null default '',
  created_at timestamptz not null default now()
);

alter table public.brand_strategy enable row level security;
alter table public.brand_documents enable row level security;

create policy "Members can view brand strategy" on public.brand_strategy for select to authenticated
  using (public.is_project_member(project_id));
create policy "Admins manage brand strategy" on public.brand_strategy for all to authenticated
  using (public.project_role(project_id) in ('owner', 'admin'))
  with check (public.project_role(project_id) in ('owner', 'admin'));

create policy "Members can view brand documents" on public.brand_documents for select to authenticated
  using (public.is_project_member(project_id));
create policy "Admins manage brand documents" on public.brand_documents for all to authenticated
  using (public.project_role(project_id) in ('owner', 'admin'))
  with check (public.project_role(project_id) in ('owner', 'admin'));

insert into storage.buckets (id, name, public)
values ('brand-documents', 'brand-documents', false)
on conflict (id) do nothing;

create policy "Members can read brand documents storage"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'brand-documents'
    and public.is_project_member((storage.foldername(name))[1]::uuid)
  );

create policy "Admins can upload brand documents storage"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'brand-documents'
    and public.project_role((storage.foldername(name))[1]::uuid) in ('owner', 'admin')
  );

create policy "Admins can delete brand documents storage"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'brand-documents'
    and public.project_role((storage.foldername(name))[1]::uuid) in ('owner', 'admin')
  );

-- ---------- Task management (global page; personal tasks stay private,
-- project-linked tasks are shared with that project's team) ----------
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  title text not null,
  notes text not null default '',
  due_date date,
  -- Deprecated in favor of `status` below; kept (unused by the app) rather
  -- than dropped, since dropping a column in a schema file that's also
  -- replayed as an idempotent migration is needlessly destructive.
  completed boolean not null default false,
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'done')),
  assignee_id uuid references public.profiles (id) on delete set null,
  source_type text not null default 'manual' check (source_type in ('manual', 'post', 'story')),
  source_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tasks enable row level security;

create policy "Members manage project tasks, users manage personal tasks"
  on public.tasks for all to authenticated
  using (
    (project_id is not null and public.is_project_member(project_id))
    or (project_id is null and user_id = auth.uid())
  )
  with check (
    (project_id is not null and public.is_project_member(project_id))
    or (project_id is null and user_id = auth.uid())
  );

create table public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  author_id uuid not null references public.profiles (id),
  text text not null,
  created_at timestamptz not null default now()
);

alter table public.task_comments enable row level security;

create policy "Task comment visibility follows task visibility"
  on public.task_comments for all to authenticated
  using (exists (
    select 1 from public.tasks t where t.id = task_comments.task_id
    and ((t.project_id is not null and public.is_project_member(t.project_id))
         or (t.project_id is null and t.user_id = auth.uid()))
  ))
  with check (
    author_id = auth.uid() and exists (
      select 1 from public.tasks t where t.id = task_comments.task_id
      and ((t.project_id is not null and public.is_project_member(t.project_id))
           or (t.project_id is null and t.user_id = auth.uid()))
    )
  );

-- Brand Moodboard: a project's permanent visual knowledge base (logos,
-- fonts, color palettes, guidelines, past campaign work, references) shown
-- on the Brief page and fed as context to "Generate Design" -- files live in
-- the existing project-media bucket (same storage policies as media_assets
-- already cover it, keyed on the projectId path prefix), so no new bucket.
create table public.brand_moodboard_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  category text not null check (
    category in ('logo', 'font', 'color', 'guideline', 'campaign', 'reference', 'texture', 'illustration', 'marketing', 'other')
  ),
  -- 'file' covers images, font files (.ttf/.otf/.woff), and PDFs (brand
  -- guideline docs) -- storage_path is set for 'file', url is set for
  -- 'link' (e.g. a Pinterest board or a hosted style guide), never both.
  kind text not null default 'file' check (kind in ('file', 'link')),
  storage_path text,
  url text,
  label text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now()
);

alter table public.brand_moodboard_items enable row level security;

create policy "Members can view brand moodboard" on public.brand_moodboard_items for select to authenticated
  using (public.is_project_member(project_id));
create policy "Admins manage brand moodboard" on public.brand_moodboard_items for all to authenticated
  using (public.project_role(project_id) in ('owner', 'admin'))
  with check (public.project_role(project_id) in ('owner', 'admin'));

-- ---------- Storage ----------
insert into storage.buckets (id, name, public)
values ('project-media', 'project-media', false)
on conflict (id) do nothing;

-- Public bucket for user profile photos, keyed by the owning user's id folder.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy "Anyone can read avatars"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'avatars');

create policy "Users can upload their own avatar"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can update their own avatar"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- Public bucket for Brief doc images: unlike project-media, brief content is a
-- long-lived document, so images need URLs that never expire (no signed-URL refresh).
insert into storage.buckets (id, name, public)
values ('brief-media', 'brief-media', true)
on conflict (id) do nothing;

create policy "Members can upload brief media"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'brief-media'
    and public.project_role((storage.foldername(name))[1]::uuid) in ('owner', 'admin')
  );

create policy "Admins can delete brief media"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'brief-media'
    and public.project_role((storage.foldername(name))[1]::uuid) in ('owner', 'admin')
  );

create policy "Members can read project media"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'project-media'
    and public.is_project_member((storage.foldername(name))[1]::uuid)
  );

create policy "Members can upload project media"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'project-media'
    and public.is_project_member((storage.foldername(name))[1]::uuid)
  );

create policy "Members can update project media"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'project-media'
    and public.is_project_member((storage.foldername(name))[1]::uuid)
  )
  with check (
    bucket_id = 'project-media'
    and public.is_project_member((storage.foldername(name))[1]::uuid)
  );

create policy "Admins can delete project media"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'project-media'
    and public.project_role((storage.foldername(name))[1]::uuid) in ('owner', 'admin')
  );

-- ---------- Settings > Activity Log: a lightweight, append-only feed of
-- notable events (media uploads, status changes, member joins) -- actor
-- name is denormalized at write time so the log stays readable even after a
-- member leaves the project. Not an exhaustive audit trail of every action. ----------
create table public.activity_log (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  actor_name text not null,
  action text not null,
  created_at timestamptz not null default now()
);

alter table public.activity_log enable row level security;

create policy "Members can view activity log"
  on public.activity_log for select
  to authenticated
  using (public.is_project_member(project_id));

create policy "Members can insert activity log"
  on public.activity_log for insert
  to authenticated
  with check (public.is_project_member(project_id));

-- ---------- Notification bell (top nav) -- real per-user notification
-- instances, distinct from project_members.notification_prefs (which just
-- stores which event types a member wants). A write checks the recipient's
-- prefs before inserting; this table is only ever the resulting feed. ----------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  event_key text not null,
  title text not null,
  description text not null default '',
  icon text not null default '🔔',
  link text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.notifications enable row level security;

create policy "Users can view their own notifications"
  on public.notifications for select
  to authenticated
  using (user_id = auth.uid());

create policy "Users can update their own notifications"
  on public.notifications for update
  to authenticated
  using (user_id = auth.uid());

-- Any project member can create a notification FOR another member (e.g. the
-- inviter writing "you were invited" to the invitee) -- not just for themself.
create policy "Project members can create notifications for other members"
  on public.notifications for insert
  to authenticated
  with check (project_id is null or public.is_project_member(project_id));

-- ---------- Brand Asset Collections ----------
-- Each row is a *link* to an external folder (Google Drive, Dropbox, etc),
-- never a copy of its contents -- this app has no OAuth/API integration
-- with any of these providers yet, so there is no automated way to list a
-- folder's files, fetch a cover image from them, or index them for search.
-- The fields below reflect that honestly: cover_storage_path/ai_status are
-- there so a real integration has a place to write to later without a
-- schema change, but nothing populates them today.
create table public.asset_collections (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  folder_url text not null,
  provider text not null default 'other'
    check (provider in ('google_drive', 'dropbox', 'box', 'onedrive', 'collect', 'other')),
  name text not null,
  asset_type text not null default 'other'
    check (asset_type in (
      'product_photography', 'campaign', 'lifestyle', 'packaging',
      'ugc', 'moodboard', 'videos', 'references', 'other'
    )),
  notes text not null default '',
  cover_storage_path text,
  ai_status text not null default 'not_configured'
    check (ai_status in ('not_configured', 'indexing', 'analyzed', 'error')),
  last_synced_at timestamptz,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

alter table public.asset_collections enable row level security;

create policy "Members can view asset collections" on public.asset_collections for select to authenticated
  using (public.is_project_member(project_id));
create policy "Admins manage asset collections" on public.asset_collections for all to authenticated
  using (public.project_role(project_id) in ('owner', 'admin'))
  with check (public.project_role(project_id) in ('owner', 'admin'));

-- ---------- Shared Client Preview ----------
-- A share_links row is an unguessable token pointing at an ordered set of
-- posts/stories from one project, meant to be opened by someone with no
-- account at all (a client) at /preview/{token}. Deleting the row (no
-- separate "revoke" flag -- same hard-delete convention as everything else
-- in this app) immediately cuts off both the RPC below and the storage
-- policy that lets that token's media be read anonymously.
create table public.share_links (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  token text not null unique,
  title text not null default '',
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.share_link_items (
  id uuid primary key default gen_random_uuid(),
  share_link_id uuid not null references public.share_links (id) on delete cascade,
  post_id uuid references public.posts (id) on delete cascade,
  story_id uuid references public.stories (id) on delete cascade,
  position integer not null default 0,
  constraint share_link_items_one_target check (
    (post_id is not null and story_id is null) or (post_id is null and story_id is not null)
  )
);

alter table public.share_links enable row level security;
alter table public.share_link_items enable row level security;

create policy "Members can view share links" on public.share_links for select to authenticated
  using (public.is_project_member(project_id));
create policy "Admins manage share links" on public.share_links for all to authenticated
  using (public.project_role(project_id) in ('owner', 'admin'))
  with check (public.project_role(project_id) in ('owner', 'admin'));

create policy "Members can view share link items" on public.share_link_items for select to authenticated
  using (exists (
    select 1 from public.share_links sl
    where sl.id = share_link_id and public.is_project_member(sl.project_id)
  ));
create policy "Admins manage share link items" on public.share_link_items for all to authenticated
  using (exists (
    select 1 from public.share_links sl
    where sl.id = share_link_id and public.project_role(sl.project_id) in ('owner', 'admin')
  ))
  with check (exists (
    select 1 from public.share_links sl
    where sl.id = share_link_id and public.project_role(sl.project_id) in ('owner', 'admin')
  ));

-- Public, unauthenticated read path for a share link's content. SECURITY
-- DEFINER so it can read posts/stories/media_assets (all otherwise
-- member-only) on behalf of an anonymous caller -- but only ever the rows
-- reachable from a token that actually exists, so nothing else is exposed.
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
        -- postId/storyId (the real content row, not just this share-link-item's
        -- own id) plus caption/notes/reviewStatus -- Client Review needs
        -- something to write approval/notes back to and something to show
        -- as the current state, none of which the anonymous read-only
        -- preview needed before Client Review existed.
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
        -- The one canonical crop for a post's cover asset (position 0) --
        -- lets the anonymous preview apply the same crop Grid shows
        -- on-screen instead of ignoring it. Null for stories (no
        -- cover_transform concept there) and for a post that's never been
        -- cropped.
        'coverTransform', (select p.cover_transform from posts p where p.id = sli.post_id),
        'media', case
          when sli.post_id is not null then (
            select coalesce(jsonb_agg(jsonb_build_object(
              'mediaAssetId', ma.id,
              'storagePath', ma.storage_path,
              'previewStoragePath', ma.preview_storage_path,
              'posterStoragePath', ma.poster_storage_path,
              'mediaType', ma.media_type
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
    -- Project member id+name, nothing else -- lets the anonymous reviewer's
    -- Notes field @mention a real team member (see mention-input.tsx),
    -- bypassing project_members' authenticated-only RLS the same way every
    -- other field on this response already does.
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

-- Client Review write-back: the review link's token itself is the
-- credential (no login) -- each function starts by checking a
-- share_link_items row actually connects this token to this post/story
-- (same reachability idiom as is_media_path_shared below), fails closed
-- otherwise, then writes straight to the real posts/stories row. This is
-- deliberately NOT the same set_post_review_status/set_story_review_status
-- pair above (those require an authenticated 'client'-role project member --
-- a different, no-longer-used access model) -- separate functions, not a
-- shared one, so the two authorization stories never get tangled together.
create function public.set_post_review_status_by_token(p_token text, p_post_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_status not in ('pending', 'approved', 'changes_requested') then
    raise exception 'Invalid status';
  end if;
  if not exists (
    select 1 from share_link_items sli
    join share_links sl on sl.id = sli.share_link_id
    where sl.token = p_token and sli.post_id = p_post_id
  ) then
    raise exception 'Not authorized';
  end if;
  update public.posts set review_status = p_status where id = p_post_id;
end;
$$;

grant execute on function public.set_post_review_status_by_token(text, uuid, text) to anon, authenticated;

create function public.set_story_review_status_by_token(p_token text, p_story_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_status not in ('pending', 'approved', 'changes_requested') then
    raise exception 'Invalid status';
  end if;
  if not exists (
    select 1 from share_link_items sli
    join share_links sl on sl.id = sli.share_link_id
    where sl.token = p_token and sli.story_id = p_story_id
  ) then
    raise exception 'Not authorized';
  end if;
  update public.stories set review_status = p_status where id = p_story_id;
end;
$$;

grant execute on function public.set_story_review_status_by_token(text, uuid, text) to anon, authenticated;

-- Writes straight into the same `notes` column the Post/Story Editor's own
-- "Notes" field already reads and writes -- deliberately not a second
-- comments table. A later submission from the same (or a different) review
-- link fully replaces the previous value, matching "the Notes field
-- becomes the single source of truth for client feedback."
create function public.set_post_notes_by_token(p_token text, p_post_id uuid, p_notes text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from share_link_items sli
    join share_links sl on sl.id = sli.share_link_id
    where sl.token = p_token and sli.post_id = p_post_id
  ) then
    raise exception 'Not authorized';
  end if;
  update public.posts set notes = p_notes where id = p_post_id;
end;
$$;

grant execute on function public.set_post_notes_by_token(text, uuid, text) to anon, authenticated;

create function public.set_story_notes_by_token(p_token text, p_story_id uuid, p_notes text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from share_link_items sli
    join share_links sl on sl.id = sli.share_link_id
    where sl.token = p_token and sli.story_id = p_story_id
  ) then
    raise exception 'Not authorized';
  end if;
  update public.stories set notes = p_notes where id = p_story_id;
end;
$$;

grant execute on function public.set_story_notes_by_token(text, uuid, text) to anon, authenticated;

-- Purely for targeting the "client left feedback" notification (see
-- notifyProjectMembers "review_comment" in share-preview-review.ts) -- not
-- used for the actual status/notes writes above, which already have their
-- own reachability checks. Same token+item reachability check as those,
-- since this still hands back project_id to an anonymous caller.
create function public.get_review_notify_context_by_token(p_token text, p_post_id uuid, p_story_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
  v_title text;
begin
  select sl.project_id into v_project_id
  from share_link_items sli
  join share_links sl on sl.id = sli.share_link_id
  where sl.token = p_token
    and ((p_post_id is not null and sli.post_id = p_post_id) or (p_story_id is not null and sli.story_id = p_story_id))
  limit 1;

  if v_project_id is null then
    raise exception 'Not authorized';
  end if;

  if p_post_id is not null then
    select left(coalesce(p.caption, ''), 60) into v_title from posts p where p.id = p_post_id;
  else
    select s.name into v_title from stories s where s.id = p_story_id;
  end if;

  return jsonb_build_object(
    'projectId', v_project_id,
    'title', nullif(v_title, ''),
    -- So the server action can resolve @mentions in the client's notes
    -- text (parseMentions) without a second query that anon RLS would
    -- just block -- same reasoning as get_shared_preview's own 'members'.
    'members', (
      select coalesce(jsonb_agg(jsonb_build_object('id', pm.user_id, 'name', pr.name)), '[]'::jsonb)
      from project_members pm
      join profiles pr on pr.id = pm.user_id
      where pm.project_id = v_project_id
    )
  );
end;
$$;

grant execute on function public.get_review_notify_context_by_token(text, uuid, uuid) to anon, authenticated;

-- A storage policy's USING clause still enforces RLS on any table its
-- subquery touches -- share_link_items/post_assets/story_frames/media_assets
-- are all "to authenticated" only, so a raw subquery here would silently see
-- zero rows for an anon caller and never grant access. SECURITY DEFINER
-- (same fix as get_shared_preview above) is what makes it actually work.
create or replace function public.is_media_path_shared(p_path text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from share_link_items sli
    left join post_assets pa on pa.post_id = sli.post_id
    left join story_frames sf on sf.story_id = sli.story_id
    join media_assets ma on ma.id = coalesce(pa.media_asset_id, sf.media_asset_id)
    where p_path in (ma.storage_path, ma.preview_storage_path, ma.poster_storage_path)
  );
$$;

grant execute on function public.is_media_path_shared(text) to anon, authenticated;

-- Lets an anonymous visitor's createSignedUrl calls succeed for exactly the
-- media referenced by an existing share link -- project-media stays private
-- to everyone else. Mirrors get_shared_preview's reachability: a path is
-- readable here iff it belongs to a post/story attached to *some* share_link
-- row, the same condition that makes get_shared_preview return it.
create policy "Public can read media for active share links"
  on storage.objects for select
  to anon, authenticated
  using (
    bucket_id = 'project-media'
    and public.is_media_path_shared(storage.objects.name)
  );

-- ---------- Client Review Mode ----------
-- Independent of `status` (draft/scheduled/published/in_review, the
-- workflow-stage field) -- a post can be status='scheduled' AND
-- review_status='approved' at once. Client Reviewer role, comments, and
-- approve/request-changes actions all key off this instead.
alter table public.posts add column review_status text not null default 'pending'
  check (review_status in ('pending', 'approved', 'changes_requested'));
alter table public.stories add column review_status text not null default 'pending'
  check (review_status in ('pending', 'approved', 'changes_requested'));

-- Same shape/policy pattern as task_comments -- any project member (any
-- role) can read/write, so owner/admin can see and reply to a client's
-- comment, not just the client who left it.
create table public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  author_id uuid not null references public.profiles (id),
  text text not null,
  created_at timestamptz not null default now()
);

create table public.story_comments (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references public.stories (id) on delete cascade,
  author_id uuid not null references public.profiles (id),
  text text not null,
  created_at timestamptz not null default now()
);

alter table public.post_comments enable row level security;
alter table public.story_comments enable row level security;

create policy "Post comment visibility follows post visibility"
  on public.post_comments for all to authenticated
  using (exists (select 1 from public.posts p where p.id = post_comments.post_id and public.is_project_member(p.project_id)))
  with check (
    author_id = auth.uid()
    and exists (select 1 from public.posts p where p.id = post_comments.post_id and public.is_project_member(p.project_id))
  );

create policy "Story comment visibility follows story visibility"
  on public.story_comments for all to authenticated
  using (exists (select 1 from public.stories s where s.id = story_comments.story_id and public.is_project_member(s.project_id)))
  with check (
    author_id = auth.uid()
    and exists (select 1 from public.stories s where s.id = story_comments.story_id and public.is_project_member(s.project_id))
  );

-- The only write surface for review_status: a plain RLS policy scoped to
-- `project_role = 'client'` couldn't stop that same UPDATE from also
-- touching caption/status/etc (RLS is row-level, not column-level), so this
-- is a SECURITY DEFINER function instead (same precedent as
-- get_shared_preview/is_media_path_shared above) that does its own
-- authorization check and only ever writes review_status. Owner/admin
-- resetting a post back to 'pending' uses a plain .update() instead,
-- already covered by their existing "Admins manage posts/stories" policy.
create function public.set_post_review_status(p_post_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
begin
  select project_id into v_project_id from public.posts where id = p_post_id;
  if v_project_id is null then
    raise exception 'Post not found';
  end if;
  if public.project_role(v_project_id) <> 'client' then
    raise exception 'Not authorized';
  end if;
  if p_status not in ('approved', 'changes_requested') then
    raise exception 'Invalid status';
  end if;
  update public.posts set review_status = p_status where id = p_post_id;
end;
$$;

grant execute on function public.set_post_review_status(uuid, text) to authenticated;

create function public.set_story_review_status(p_story_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
begin
  select project_id into v_project_id from public.stories where id = p_story_id;
  if v_project_id is null then
    raise exception 'Story not found';
  end if;
  if public.project_role(v_project_id) <> 'client' then
    raise exception 'Not authorized';
  end if;
  if p_status not in ('approved', 'changes_requested') then
    raise exception 'Invalid status';
  end if;
  update public.stories set review_status = p_status where id = p_story_id;
end;
$$;

grant execute on function public.set_story_review_status(uuid, text) to authenticated;

-- ---------- Landing Demo Content Manager ----------
-- One row per editable content key (grid images, brand copy, team demo
-- data, etc.), replacing what used to be hardcoded TS constants in
-- src/lib/landing/demo-*.ts -- the page still ships with those as its
-- fallback defaults (merged in at request time), this table only overrides
-- whichever keys an admin has actually edited. No project scoping -- the
-- public marketing page needs to read this anonymously.
create table public.landing_demo_content (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.landing_demo_content enable row level security;

create policy "Anyone can read landing demo content"
  on public.landing_demo_content for select
  to anon, authenticated
  using (true);

create policy "Admins manage landing demo content"
  on public.landing_demo_content for all
  to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and is_admin))
  with check (exists (select 1 from public.profiles where id = auth.uid() and is_admin));

insert into storage.buckets (id, name, public)
values ('landing-media', 'landing-media', true)
on conflict (id) do nothing;

create policy "Anyone can read landing media"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'landing-media');

create policy "Admins manage landing media"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'landing-media' and exists (select 1 from public.profiles where id = auth.uid() and is_admin))
  with check (bucket_id = 'landing-media' and exists (select 1 from public.profiles where id = auth.uid() and is_admin));

-- ---------- Account: Workspace & Preferences settings ----------
-- Two jsonb columns rather than one column per setting -- both sections are
-- explicitly meant to grow (new Workspace/Preferences fields later) without
-- another migration each time, same reasoning as project_members'
-- notification_prefs jsonb column.
alter table public.profiles add column if not exists workspace_settings jsonb not null default '{}'::jsonb;
alter table public.profiles add column if not exists preferences jsonb not null default '{}'::jsonb;

-- ---------- Content Hub: folders ----------
-- Stories is being generalized into "Content" at the UI level (cosmetic
-- rename only -- table/route/action names are unchanged, see AGENTS.md-adjacent
-- session notes). This adds an optional folder layer above stories; a story
-- row already models "one item -> many files" via story_frames, so no new
-- file-grouping table is needed, just a place to group items.
create table public.content_folders (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

alter table public.content_folders enable row level security;

create policy "Members can view content folders" on public.content_folders for select to authenticated
  using (public.is_project_member(project_id));
create policy "Admins manage content folders" on public.content_folders for all to authenticated
  using (public.project_role(project_id) in ('owner', 'admin'))
  with check (public.project_role(project_id) in ('owner', 'admin'));

-- Ungrouped items stay ungrouped (shown in an "Unfiled" bucket) rather than
-- being blocked or cascade-deleted, same on-delete behavior as
-- media_assets.folder_id.
alter table public.stories add column if not exists folder_id uuid references public.content_folders (id) on delete set null;

-- Widen status additively -- existing draft/scheduled/published rows are
-- untouched, the new values just become legal alongside them (no data rewrite).
alter table public.stories drop constraint if exists stories_status_check;
alter table public.stories add constraint stories_status_check
  check (status in ('draft', 'scheduled', 'published', 'ready', 'approved', 'sent', 'delivered'));

-- ---------- Brief: lightweight internal review state ----------
-- Generic, team-agnostic workflow state -- not tied to any specific role or
-- "approved by owner" concept. Existing owner/admin-only RLS on brief_tasks
-- already covers writes to this column, so no new policy is needed.
alter table public.brief_tasks add column if not exists status text not null default 'draft'
  check (status in ('draft', 'internal_review', 'ready_for_design'));

-- ---------- Brand Moodboard: custom brand fonts ----------
-- The 'font' category already existed on brand_moodboard_items -- these
-- columns just make an uploaded font file a real, loadable webfont instead
-- of an inert attachment. Rows sharing the same font_family are treated as
-- different faces (weight/style) of one logical font, same as real
-- @font-face -- no separate font-group table needed.
alter table public.brand_moodboard_items add column if not exists font_family text;
alter table public.brand_moodboard_items add column if not exists font_weight text;
alter table public.brand_moodboard_items add column if not exists font_style text;

-- ---------- Large upload limits ----------
-- Explicit, verified 50MB per-bucket ceiling (matching Supabase Storage's
-- own documented Free-tier project-wide default) rather than an assumed
-- dashboard setting -- see src/lib/upload-limits.ts, the single source of
-- truth this mirrors. Uploads now go direct browser-to-Storage (see
-- src/lib/direct-upload.ts) for every real file-picker path, bypassing
-- Vercel's separate, non-configurable ~4.5MB Function request-body limit
-- that every FormData-through-a-Server-Action upload was actually bound by.
update storage.buckets set file_size_limit = 52428800
where id in ('project-media', 'brief-media', 'brand-documents', 'avatars', 'landing-media');

-- ============================================================================
--  PART 2 of 5 -- fix_brief_video_items.sql
--  Brief: video items + the attachments poster column (not in schema.sql)
--  (copied as-is from supabase/fix_brief_video_items.sql; only its own begin;/commit; lines removed)
-- ============================================================================

-- Adds VIDEO as a first-class Brief item kind, alongside the existing
-- 'link'/'image'. Two changes, both additive/widening, neither touches any
-- existing row's data:
--
--   1. brief_task_items.kind's CHECK constraint currently only allows
--      ('link', 'image') -- widened to also allow 'video'. Every existing
--      row already satisfies the new, looser constraint unchanged (it's a
--      superset of the old one), so this is a metadata-only change with no
--      data rewrite and no risk of an existing row suddenly violating it.
--
--   2. brief_attachments gets a new nullable poster_storage_path column,
--      used only for a video item's auto-generated poster/thumbnail frame
--      (mirrors media_assets.poster_storage_path's existing role for
--      Grid/Post/Story videos). NULL for every existing row (all of which
--      are images, which have no poster) and NULL for a video whose poster
--      generation failed -- the video item itself still saves fine either
--      way; the app falls back to a generic video icon when this is null.
--
-- Do NOT apply this yourself -- see the accompanying report. Run in the
-- Supabase SQL editor. Idempotent (safe to re-run) and transactional
-- (all-or-nothing).

-- brief_task_items_kind_check is Postgres's standard auto-generated name
-- for an inline CHECK on this column (<table>_<column>_check) -- the
-- `drop constraint if exists` is defensive (a no-op if the live name ever
-- differs), the `add constraint` below always (re)creates it with this
-- exact name and the widened, correct definition either way.
alter table public.brief_task_items drop constraint if exists brief_task_items_kind_check;
alter table public.brief_task_items add constraint brief_task_items_kind_check
  check (kind in ('link', 'image', 'video'));

alter table public.brief_attachments add column if not exists poster_storage_path text;

-- Force PostgREST to reload its schema cache so both changes (and anything
-- else pending) are picked up immediately, not after its own next periodic
-- refresh.
notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------------
-- ROLLBACK -- only if you need to revert.
--
-- Reverting the kind constraint is safe ONLY if no 'video' rows exist yet --
-- if any do, this DROP+ADD fails with the same violation error this
-- migration exists to prevent, applied in reverse (delete or re-type those
-- rows first if you ever need to roll back after real video items exist).
--
-- The poster_storage_path column is deliberately NOT dropped by default --
-- if any video items were added while this migration was live, their real
-- poster paths would be destroyed. Only drop it (separate statement below,
-- commented out on its own) once you've confirmed no video item still
-- depends on it.
--
-- begin;
-- alter table public.brief_task_items drop constraint if exists brief_task_items_kind_check;
-- alter table public.brief_task_items add constraint brief_task_items_kind_check
--   check (kind in ('link', 'image'));
-- notify pgrst, 'reload schema';
-- commit;
--
-- -- Only if you also want the column gone (destroys any stored poster
-- -- paths -- confirm nothing needs them first):
-- -- alter table public.brief_attachments drop column if exists poster_storage_path;
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- READ-ONLY VERIFICATION -- run after, no writes.
--
-- 1. Confirm the constraint now allows all three kinds:
-- select conname, pg_get_constraintdef(oid)
-- from pg_constraint
-- where conrelid = 'public.brief_task_items'::regclass
--   and conname = 'brief_task_items_kind_check';
-- -- expect: CHECK (kind = ANY (ARRAY['link'::text, 'image'::text, 'video'::text]))
--
-- 2. Confirm the new column exists and is nullable:
-- select column_name, data_type, is_nullable
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'brief_attachments'
--   and column_name = 'poster_storage_path';
-- -- expect: poster_storage_path | text | YES
--
-- 3. Confirm no existing rows were touched (every existing item is still
--    'link' or 'image', every existing attachment's poster_storage_path is
--    null -- compare this count to the table's known row count beforehand):
-- select kind, count(*) from public.brief_task_items group by kind order by 1;
-- select count(*) filter (where poster_storage_path is not null) as attachments_with_poster,
--        count(*) as total_attachments
-- from public.brief_attachments;
-- ---------------------------------------------------------------------------

-- ============================================================================
--  PART 3 of 5 -- fix_admin_dashboard_schema.sql
--  system_events + user_presence tables, and the rule that nobody can make themselves a global admin
--  (copied as-is from supabase/fix_admin_dashboard_schema.sql; only its own begin;/commit; lines removed)
-- ============================================================================

-- Internal Admin Dashboard: schema additions.
-- Run this in the Supabase SQL editor. Idempotent (safe to re-run), matches
-- the style of the other fix_*_schema.sql files in this directory.
--
-- Wrapped in a transaction so the whole migration applies atomically (all
-- statements succeed, or none do) and so there's no window, however brief,
-- where the profiles UPDATE policy has been dropped but not yet replaced.

-- ---------------------------------------------------------------------------
-- 1. CRITICAL: close a pre-existing privilege-escalation gap.
--
-- "Users can update their own profile" (schema.sql) only has a USING clause
-- (id = auth.uid()), no WITH CHECK -- Postgres RLS then defaults the check to
-- the USING expression too, which never references is_admin at all. That
-- means any authenticated user could currently call
-- `supabase.from('profiles').update({ is_admin: true }).eq('id', myId)`
-- directly from the browser (with only the public anon key) and grant
-- themselves admin. Discovered while building this feature -- fixing it is a
-- prerequisite for the admin dashboard's own security guarantee (an
-- is_admin-gated page is not private if is_admin is self-assignable), not
-- unrelated hardening. Everything else about that policy (users can still
-- freely update their own name/avatar_url/email/preferences/etc.) is
-- unchanged.
-- ---------------------------------------------------------------------------
drop policy if exists "Users can update their own profile" on public.profiles;

create policy "Users can update their own profile"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and is_admin = (select p.is_admin from public.profiles p where p.id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 2. Presence -- "who's active right now."
--
-- Separate table rather than a profiles.last_seen_at column: profiles has a
-- blanket "viewable by any authenticated user" SELECT policy (needed
-- app-wide for @mentions/assignee pickers/etc.), which would otherwise let
-- any normal user read everyone else's presence directly via the client SDK
-- -- exactly the cross-user data this dashboard is supposed to keep
-- admin-only. This table gets NO policies for authenticated/anon at all, so
-- normal client queries against it return nothing; every read AND write goes
-- through server code (the heartbeat Server Action, and the admin dashboard
-- query) using the service-role client, which bypasses RLS entirely by
-- design. One row per user, upserted -- not an event log.
-- ---------------------------------------------------------------------------
create table if not exists public.user_presence (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  last_seen_at timestamptz not null default now()
);

alter table public.user_presence enable row level security;
-- Deliberately zero policies -- see comment above.

-- ---------------------------------------------------------------------------
-- 3. System events -- the one thing "recent activity" can't already derive
-- from existing timestamps: meaningful operation FAILURES. (Project/media/
-- post/story creation are already fully derivable from their own
-- created_at columns -- no separate write needed for those, see
-- admin-dashboard.ts.)
--
-- INSERT is open to any authenticated user (matching activity-log.ts's own
-- existing best-effort, fire-and-forget pattern) but constrained so a
-- request can only ever attribute an event to itself, never forge one under
-- another user's id. There is deliberately NO select policy for
-- authenticated/anon -- only the service-role client (admin dashboard) can
-- read these back, so a normal user can write a failure record about their
-- own action but can never read the aggregate failure log.
-- ---------------------------------------------------------------------------
create table if not exists public.system_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  severity text not null default 'error' check (severity in ('error', 'warning')),
  category text not null,
  area text not null,
  message text not null,
  project_id uuid references public.projects(id) on delete set null,
  user_id uuid references public.profiles(id) on delete set null
);

create index if not exists system_events_created_at_idx on public.system_events (created_at desc);

alter table public.system_events enable row level security;

drop policy if exists "Authenticated users can log their own system events" on public.system_events;
create policy "Authenticated users can log their own system events"
  on public.system_events for insert
  to authenticated
  with check (user_id is null or user_id = auth.uid());
-- No select policy -- admin-only, via service-role.

-- ============================================================================
--  PART 4 of 5 -- fix_project_visit_recency.sql
--  per-user 'last visited project' column
--  (copied as-is from supabase/fix_project_visit_recency.sql; only its own begin;/commit; lines removed)
-- ============================================================================

-- Per-user "most recently visited project" tracking for the Projects page.
--
-- WHY: the Projects list previously had no notion of "the project I was
-- just working in" -- the only existing recency signal anywhere (nav
-- switcher ordering, the landing-page redirect fallback) is
-- projects.created_at, which is shared across the whole team and never
-- reflects one individual user's own navigation. This adds a per-
-- (project_id, user_id) timestamp on the existing project_members
-- membership row -- no new table, since project_members is already keyed
-- exactly (project_id, user_id), and this is set once per project entry,
-- never on every render/click/route inside an already-open project.
--
-- Run this in the Supabase SQL editor. Idempotent (safe to re-run) and
-- transactional (all-or-nothing, no window where the column is half-added).
--
-- The application already isolates every read/write of this column from
-- everything else (same "isolate new/pending-migration columns" pattern
-- already used for `archived`, `instagram_url`/`tiktok_url`, etc. elsewhere
-- in this codebase) -- so the Projects page, and project entry itself,
-- keep working exactly as before if this migration hasn't been applied yet;
-- recency ordering just silently falls back to created-date-first until it
-- is.

alter table public.project_members
  add column if not exists last_visited_at timestamptz;

-- Speeds up "this user's projects, most-recently-visited first" -- a
-- per-user ordering over what's normally a small (tens, not thousands) set
-- of rows per user, but the index costs nothing to have and matters once a
-- user belongs to many projects.
create index if not exists idx_project_members_user_last_visited
  on public.project_members (user_id, last_visited_at desc);

notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------------
-- ROLLBACK -- only if you need to revert. Safe at any time: this only drops
-- the new column/index, no other data (memberships, roles, permissions) is
-- touched.
--
-- begin;
-- drop index if exists public.idx_project_members_user_last_visited;
-- alter table public.project_members drop column if exists last_visited_at;
-- notify pgrst, 'reload schema';
-- commit;
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- READ-ONLY POST-MIGRATION VERIFICATION -- run these after, no writes.
--
-- 1. Confirm the column and index now exist:
-- select column_name, data_type
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'project_members'
--   and column_name = 'last_visited_at';
--
-- select indexname from pg_indexes
-- where schemaname = 'public' and tablename = 'project_members'
--   and indexname = 'idx_project_members_user_last_visited';
--
-- 2. Confirm no existing membership rows were touched/lost (compare this
--    count to whatever you already know project_members' row count to be):
-- select count(*) from public.project_members;
--
-- 3. Confirm every row's new column starts out null (nothing is
--    retroactively marked "visited" -- ordering falls back to created-date
--    for every project until a user actually opens it again):
-- select count(*) from public.project_members where last_visited_at is not null;
-- -- expect: 0 immediately after migration
-- ---------------------------------------------------------------------------

-- ============================================================================
--  PART 5 of 5 -- fix_project_role_permission_presets.sql
--  what each role may do: Member can edit content, Viewer/Client cannot
--  (copied as-is from supabase/fix_project_role_permission_presets.sql; only its own begin;/commit; lines removed)
-- ============================================================================

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

commit;

-- ----------------------------------------------------------------------------
--  RESULT -- one row. Expect: STAGING SETUP COMPLETE, 40 tables, 84 table
--  rules, 15 storage rules, 5 buckets, 0 tables without row-level security.
-- ----------------------------------------------------------------------------
select
  'STAGING SETUP COMPLETE' as status,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE') as tables,
  (select count(*) from pg_policies where schemaname = 'public') as table_rules,
  (select count(*) from pg_policies where schemaname = 'storage') as storage_rules,
  (select count(*) from storage.buckets) as buckets,
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity) as tables_without_rls;
