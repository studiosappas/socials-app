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
  media_type text not null default 'image' check (media_type in ('image', 'video')),
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
  -- True only for a design created by Brief's "Generate Design" -- purely
  -- cosmetic (a small badge in Media Library), never gates anything: a
  -- generated asset is edited/saved/used exactly like a manual upload the
  -- instant it exists.
  generated_by_ai boolean not null default false,
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

-- ---------- Brief image attachments (original preserved separately from annotations) ----------
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
  storage_path text not null,
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
