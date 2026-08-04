-- Grid page redesign schema additions. Idempotent -- safe to run even if
-- some pieces already exist. Run this once in the Supabase SQL editor,
-- alongside the other still-pending fix_*.sql files.

alter table public.projects
  add column if not exists content_pillars text not null default '';

alter table public.projects
  add column if not exists industry text not null default '';

create table if not exists public.project_sections (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null default '',
  body text not null default '',
  position integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.project_sections enable row level security;

drop policy if exists "Members can view project sections" on public.project_sections;
create policy "Members can view project sections" on public.project_sections for select to authenticated
  using (public.is_project_member(project_id));
drop policy if exists "Admins manage project sections" on public.project_sections;
create policy "Admins manage project sections" on public.project_sections for all to authenticated
  using (public.project_role(project_id) in ('owner', 'admin'))
  with check (public.project_role(project_id) in ('owner', 'admin'));

notify pgrst, 'reload schema';
