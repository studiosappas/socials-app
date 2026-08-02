-- Batch 2 schema additions (Calendar/Grid/Overview/Brief/To-Do improvements).
-- Idempotent -- safe to run even if some pieces already exist. Run this once
-- in the Supabase SQL editor, alongside the still-pending fix_projects_ig_columns.sql.

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
