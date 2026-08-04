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
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'published', 'in_review')),
  created_at timestamptz not null default now()
);

create table public.grid_slots (
  id uuid primary key default gen_random_uuid(),
  row_id uuid not null references public.grid_rows (id) on delete cascade,
  position integer not null check (position between 0 and 2),
  post_id uuid references public.posts (id) on delete set null,
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

-- ---------- Personal to-do list (global, user-scoped, spans every project) ----------
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  title text not null,
  notes text not null default '',
  due_date date,
  completed boolean not null default false,
  source_type text not null default 'manual' check (source_type in ('manual', 'post', 'story')),
  source_id uuid,
  created_at timestamptz not null default now()
);

alter table public.tasks enable row level security;

create policy "Users manage their own tasks" on public.tasks for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

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
