-- Batch 2 schema additions (Calendar/Grid/Overview/Brief/To-Do improvements).
-- Idempotent -- safe to run even if some pieces already exist. Run this once
-- in the Supabase SQL editor, alongside the still-pending fix_projects_ig_columns.sql.

-- ---------- Overview dashboard: brand header, strategy, knowledge base ----------
alter table public.projects
  add column if not exists logo_storage_path text,
  add column if not exists brand_image_storage_path text;

alter table public.stories
  add column if not exists status text not null default 'draft' check (status in ('draft', 'scheduled', 'published'));

alter table public.posts drop constraint if exists posts_status_check;
alter table public.posts add constraint posts_status_check
  check (status in ('draft', 'scheduled', 'published', 'in_review'));

create table if not exists public.brand_strategy (
  project_id uuid primary key references public.projects (id) on delete cascade,
  brand_values text not null default '',
  vision text not null default '',
  voice text not null default '',
  positioning text not null default '',
  audience_notes text not null default '',
  ai_summary text not null default '',
  spectrum_serious_playful smallint not null default 50,
  spectrum_classic_futuristic smallint not null default 50,
  spectrum_premium_accessible smallint not null default 50,
  spectrum_editorial_commercial smallint not null default 50,
  spectrum_minimal_expressive smallint not null default 50,
  spectrum_luxury_casual smallint not null default 50,
  updated_at timestamptz not null default now()
);

create table if not exists public.brand_documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  storage_path text not null,
  filename text not null,
  uploaded_by uuid not null references public.profiles (id),
  ai_analysis text not null default '',
  created_at timestamptz not null default now()
);

alter table public.brand_strategy enable row level security;
alter table public.brand_documents enable row level security;

drop policy if exists "Members can view brand strategy" on public.brand_strategy;
create policy "Members can view brand strategy" on public.brand_strategy for select to authenticated
  using (public.is_project_member(project_id));
drop policy if exists "Admins manage brand strategy" on public.brand_strategy;
create policy "Admins manage brand strategy" on public.brand_strategy for all to authenticated
  using (public.project_role(project_id) in ('owner', 'admin'))
  with check (public.project_role(project_id) in ('owner', 'admin'));

drop policy if exists "Members can view brand documents" on public.brand_documents;
create policy "Members can view brand documents" on public.brand_documents for select to authenticated
  using (public.is_project_member(project_id));
drop policy if exists "Admins manage brand documents" on public.brand_documents;
create policy "Admins manage brand documents" on public.brand_documents for all to authenticated
  using (public.project_role(project_id) in ('owner', 'admin'))
  with check (public.project_role(project_id) in ('owner', 'admin'));

insert into storage.buckets (id, name, public)
values ('brand-documents', 'brand-documents', false)
on conflict (id) do nothing;

drop policy if exists "Members can read brand documents storage" on storage.objects;
create policy "Members can read brand documents storage"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'brand-documents'
    and public.is_project_member((storage.foldername(name))[1]::uuid)
  );

drop policy if exists "Admins can upload brand documents storage" on storage.objects;
create policy "Admins can upload brand documents storage"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'brand-documents'
    and public.project_role((storage.foldername(name))[1]::uuid) in ('owner', 'admin')
  );

drop policy if exists "Admins can delete brand documents storage" on storage.objects;
create policy "Admins can delete brand documents storage"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'brand-documents'
    and public.project_role((storage.foldername(name))[1]::uuid) in ('owner', 'admin')
  );

-- ---------- Brief image attachments ----------
create table if not exists public.brief_attachments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  original_storage_path text not null,
  preview_storage_path text,
  annotation_json jsonb,
  created_at timestamptz not null default now()
);

alter table public.brief_attachments enable row level security;

drop policy if exists "Members can view brief attachments" on public.brief_attachments;
create policy "Members can view brief attachments" on public.brief_attachments for select to authenticated
  using (public.is_project_member(project_id));
drop policy if exists "Admins manage brief attachments" on public.brief_attachments;
create policy "Admins manage brief attachments" on public.brief_attachments for all to authenticated
  using (public.project_role(project_id) in ('owner', 'admin'))
  with check (public.project_role(project_id) in ('owner', 'admin'));

-- ---------- Personal to-do list ----------
create table if not exists public.tasks (
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

drop policy if exists "Users manage their own tasks" on public.tasks;
create policy "Users manage their own tasks" on public.tasks for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Force PostgREST to reload its schema cache so it picks up the new table immediately.
notify pgrst, 'reload schema';
