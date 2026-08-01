-- Social Content Planner schema + RLS policies
-- Run this in the Supabase SQL editor for your project.

create extension if not exists "pgcrypto";

-- ---------- Profiles ----------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null,
  avatar_url text,
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
  insert into public.profiles (id, name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)));
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
  platform text not null default 'instagram' check (platform in ('instagram', 'tiktok')),
  ig_username text not null default '',
  ig_display_name text not null default '',
  ig_bio text not null default '',
  ig_posts_count integer not null default 0,
  ig_followers_count integer not null default 0,
  ig_following_count integer not null default 0,
  ig_website_link text not null default '',
  ig_handle text not null default '',
  profile_photo_path text,
  show_scheduled_dates boolean not null default true,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create type public.project_role as enum ('owner', 'admin', 'designer');

create table public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.project_role not null default 'designer',
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

-- ---------- Media library ----------
create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  storage_path text not null,
  media_type text not null default 'image' check (media_type in ('image', 'video')),
  uploaded_by uuid not null references public.profiles (id),
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

create policy "Owners/admins can delete media"
  on public.media_assets for delete
  to authenticated
  using (public.project_role(project_id) in ('owner', 'admin'));

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
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'published')),
  created_at timestamptz not null default now()
);

create table public.grid_slots (
  id uuid primary key default gen_random_uuid(),
  row_id uuid not null references public.grid_rows (id) on delete cascade,
  position integer not null check (position between 0 and 2),
  post_id uuid references public.posts (id) on delete set null,
  unique (row_id, position)
);

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
  position integer not null default 0,
  created_at timestamptz not null default now()
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

create policy "Members can view stories" on public.stories for select to authenticated using (public.is_project_member(project_id));
create policy "Admins manage stories" on public.stories for all to authenticated
  using (public.project_role(project_id) in ('owner', 'admin'))
  with check (public.project_role(project_id) in ('owner', 'admin'));

create policy "Members can view story frames" on public.story_frames for select to authenticated
  using (exists (select 1 from public.stories s where s.id = story_id and public.is_project_member(s.project_id)));
create policy "Admins manage story frames" on public.story_frames for all to authenticated
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

-- ---------- Brief (Notion-style live doc per project) ----------
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

-- ---------- Storage ----------
insert into storage.buckets (id, name, public)
values ('project-media', 'project-media', false)
on conflict (id) do nothing;

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
