-- ============================================================================
-- Consolidated pending migrations. Run this ONE file in the Supabase SQL
-- editor -- it combines every still-pending fix_*.sql file plus a new fix
-- for the grid drag-and-drop duplication bug. Fully idempotent (safe to
-- re-run even if some pieces are already applied).
--
-- This single file resolves, in one shot:
--   - Notes / Content Quantity not saving on the Grid sidebar
--   - "Add to To-Do List" silently doing nothing
--   - Crop-mode zoom/pan not persisting after reload
--   - Grid drag-and-drop occasionally duplicating a post across two slots
-- ============================================================================

-- ---------- fix_projects_ig_columns.sql ----------
alter table public.projects
  add column if not exists ig_username text not null default '',
  add column if not exists ig_display_name text not null default '',
  add column if not exists ig_bio text not null default '',
  add column if not exists ig_posts_count integer not null default 0,
  add column if not exists ig_followers_count integer not null default 0,
  add column if not exists ig_following_count integer not null default 0,
  add column if not exists ig_website_link text not null default '',
  add column if not exists ig_handle text not null default '',
  add column if not exists profile_photo_path text,
  add column if not exists show_scheduled_dates boolean not null default true;

-- ---------- fix_batch2_schema.sql ----------
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

-- ---------- fix_sprint08_schema.sql ----------
alter table public.grid_slots
  add column if not exists cover_transform jsonb;

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "Anyone can read avatars" on storage.objects;
create policy "Anyone can read avatars"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'avatars');

drop policy if exists "Users can upload their own avatar" on storage.objects;
create policy "Users can upload their own avatar"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users can update their own avatar" on storage.objects;
create policy "Users can update their own avatar"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- fix_grid_redesign_schema.sql ----------
alter table public.projects
  add column if not exists content_pillars text not null default '';

alter table public.projects
  add column if not exists industry text not null default '';

-- Posts/Stories-a-week is a fixed value set manually in the Overview edit
-- mode, not a live count of scheduled content.
alter table public.projects
  add column if not exists posts_per_week smallint not null default 0,
  add column if not exists stories_per_week smallint not null default 0;

-- ---------- Calendar notes (defined in schema.sql but never actually
-- included in any prior fix_*.sql -- this table has never existed live). ----------
create table if not exists public.calendar_notes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  date date not null,
  body text not null default '',
  created_at timestamptz not null default now()
);

alter table public.calendar_notes enable row level security;

drop policy if exists "Members can view calendar notes" on public.calendar_notes;
create policy "Members can view calendar notes" on public.calendar_notes for select to authenticated
  using (public.is_project_member(project_id));
drop policy if exists "Admins manage calendar notes" on public.calendar_notes;
create policy "Admins manage calendar notes" on public.calendar_notes for all to authenticated
  using (public.project_role(project_id) in ('owner', 'admin'))
  with check (public.project_role(project_id) in ('owner', 'admin'));

-- ---------- Stories page redesign: notes field (search + editor parity with Posts) ----------
alter table public.stories
  add column if not exists notes text not null default '';

-- ---------- Stories page redesign: a proper Links section (separate from
-- each frame's own tap-through link), mirroring post_links exactly. ----------
create table if not exists public.story_links (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references public.stories (id) on delete cascade,
  url text not null,
  label text not null default ''
);

alter table public.story_links enable row level security;

drop policy if exists "Members can view story links" on public.story_links;
create policy "Members can view story links" on public.story_links for select to authenticated
  using (exists (select 1 from public.stories s where s.id = story_id and public.is_project_member(s.project_id)));
drop policy if exists "Admins manage story links" on public.story_links;
create policy "Admins manage story links" on public.story_links for all to authenticated
  using (exists (select 1 from public.stories s where s.id = story_id and public.project_role(s.project_id) in ('owner', 'admin')))
  with check (exists (select 1 from public.stories s where s.id = story_id and public.project_role(s.project_id) in ('owner', 'admin')));

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

-- ---------- Brief v2: structured per-task content briefs (replaces the old
-- free-text project_briefs doc). brief_attachments is included defensively
-- (if not exists) in case it hasn't landed live yet either. ----------
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

insert into storage.buckets (id, name, public)
values ('brief-media', 'brief-media', true)
on conflict (id) do nothing;

drop policy if exists "Members can upload brief media" on storage.objects;
create policy "Members can upload brief media"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'brief-media'
    and public.project_role((storage.foldername(name))[1]::uuid) in ('owner', 'admin')
  );

drop policy if exists "Admins can delete brief media" on storage.objects;
create policy "Admins can delete brief media"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'brief-media'
    and public.project_role((storage.foldername(name))[1]::uuid) in ('owner', 'admin')
  );

create table if not exists public.brief_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null default 'Task',
  content_type text not null default 'story' check (content_type in ('story', 'newsletter')),
  position int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.brief_task_items (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.brief_tasks (id) on delete cascade,
  section text not null check (section in ('references', 'images', 'products')),
  kind text not null check (kind in ('link', 'image')),
  url text,
  label text not null default '',
  attachment_id uuid references public.brief_attachments (id) on delete set null,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.brief_task_frames (
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

drop policy if exists "Members can view brief tasks" on public.brief_tasks;
create policy "Members can view brief tasks" on public.brief_tasks for select to authenticated
  using (public.is_project_member(project_id));
drop policy if exists "Admins manage brief tasks" on public.brief_tasks;
create policy "Admins manage brief tasks" on public.brief_tasks for all to authenticated
  using (public.project_role(project_id) in ('owner', 'admin'))
  with check (public.project_role(project_id) in ('owner', 'admin'));

drop policy if exists "Members can view brief task items" on public.brief_task_items;
create policy "Members can view brief task items" on public.brief_task_items for select to authenticated
  using (exists (select 1 from public.brief_tasks t where t.id = task_id and public.is_project_member(t.project_id)));
drop policy if exists "Admins manage brief task items" on public.brief_task_items;
create policy "Admins manage brief task items" on public.brief_task_items for all to authenticated
  using (exists (select 1 from public.brief_tasks t where t.id = task_id and public.project_role(t.project_id) in ('owner', 'admin')))
  with check (exists (select 1 from public.brief_tasks t where t.id = task_id and public.project_role(t.project_id) in ('owner', 'admin')));

drop policy if exists "Members can view brief task frames" on public.brief_task_frames;
create policy "Members can view brief task frames" on public.brief_task_frames for select to authenticated
  using (exists (select 1 from public.brief_tasks t where t.id = task_id and public.is_project_member(t.project_id)));
drop policy if exists "Admins manage brief task frames" on public.brief_task_frames;
create policy "Admins manage brief task frames" on public.brief_task_frames for all to authenticated
  using (exists (select 1 from public.brief_tasks t where t.id = task_id and public.project_role(t.project_id) in ('owner', 'admin')))
  with check (exists (select 1 from public.brief_tasks t where t.id = task_id and public.project_role(t.project_id) in ('owner', 'admin')));

-- ---------- New: atomic grid-slot reassignment ----------
-- Reordering/moving posts across grid slots previously ran one UPDATE per
-- slot in parallel (Promise.all of independent requests) with no shared
-- transaction. Under real-world timing, a concurrent read could catch the
-- grid mid-update and see the same post_id assigned to two slots at once --
-- the intermittent "duplicate post" bug. Wrapping every slot reassignment
-- in a single plpgsql function makes the whole batch commit atomically.
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

-- Defensive safety net: a post can only ever occupy one grid slot at a time,
-- so a duplicate assignment now fails loudly instead of silently rendering.
-- Deferred so a swap between two slots (each briefly holding the other's
-- post_id mid-batch) doesn't trip the constraint until commit.
alter table public.grid_slots drop constraint if exists grid_slots_post_id_unique;
alter table public.grid_slots
  add constraint grid_slots_post_id_unique unique (post_id) deferrable initially deferred;

-- ---------- Brief v2 refinements: multi-select task type, per-item notes,
-- editable frame labels ----------
alter table public.brief_tasks
  add column if not exists content_types text[] not null default array['story'];

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'brief_tasks' and column_name = 'content_type'
  ) then
    update public.brief_tasks set content_types = array[content_type] where content_type is not null;
    alter table public.brief_tasks drop column content_type;
  end if;
end $$;

alter table public.brief_task_items
  add column if not exists notes text not null default '';

-- ---------- Overview page: AI brand-section accordion, AI recommendations,
-- and link-type brand knowledge sources (website/IG, not just uploaded files) ----------
alter table public.brand_strategy
  add column if not exists ai_brand_dna text not null default '',
  add column if not exists ai_tone_of_voice text not null default '',
  add column if not exists ai_communication_style text not null default '',
  add column if not exists ai_content_pillars text not null default '',
  add column if not exists ai_audience_snapshot text not null default '',
  add column if not exists ai_visual_language text not null default '',
  add column if not exists ai_avoid text not null default '',
  add column if not exists ai_insights jsonb,
  add column if not exists ai_insights_updated_at timestamptz;

alter table public.brand_documents
  add column if not exists source_type text not null default 'file' check (source_type in ('file', 'link')),
  add column if not exists url text;
alter table public.brand_documents alter column storage_path drop not null;

-- ---------- Overview Edit Profile: weekly content amounts for Reels and
-- Newsletter (posts_per_week/stories_per_week already existed) ----------
alter table public.projects
  add column if not exists reels_per_week smallint not null default 0,
  add column if not exists newsletter_per_week smallint not null default 0;

-- Force PostgREST to reload its schema cache so every change above (new
-- columns, tables, and the new RPC function) is picked up immediately.
notify pgrst, 'reload schema';
