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

-- ---------- Post/Grid asset annotation editing: same original/preview/
-- annotation_json pattern as brief_attachments, but on media_assets itself
-- since an uploaded asset (not a separate attachment row) is already the
-- shared source both post_assets and Grid's cover-image lookup point at ----------
alter table public.media_assets
  add column if not exists preview_storage_path text,
  add column if not exists annotation_json jsonb;

drop policy if exists "Admins update media" on public.media_assets;
create policy "Admins update media" on public.media_assets for update to authenticated
  using (public.project_role(project_id) in ('owner', 'admin'))
  with check (public.project_role(project_id) in ('owner', 'admin'));

-- ---------- Grid video support + crop-follows-the-post fix ----------
-- Static first-frame capture for video assets, generated client-side at
-- upload time -- lets Grid show a poster image for a video cover instead of
-- ever mounting a <video> element there.
alter table public.media_assets
  add column if not exists poster_storage_path text;

-- Crop/pan/zoom now lives on the post itself (its cover is always the first
-- carousel asset) instead of on grid_slots, so it follows the post when
-- moved to a different cell instead of staying behind attached to the old
-- cell. grid_slots.cover_transform is left in place, unused, rather than
-- dropped, to avoid a migration that could strand data.
alter table public.posts
  add column if not exists cover_transform jsonb;

-- ---------- Settings redesign: expanded roles, custom permissions, more
-- platforms, per-member notification prefs, activity log, archive flag ----------
alter type public.project_role add value if not exists 'editor';
alter type public.project_role add value if not exists 'viewer';
alter type public.project_role add value if not exists 'client';

alter table public.project_members
  add column if not exists custom_permissions text[],
  add column if not exists notification_prefs jsonb not null default '{}'::jsonb;

alter table public.projects
  add column if not exists archived boolean not null default false;

alter table public.projects drop constraint if exists projects_platform_check;
alter table public.projects add constraint projects_platform_check
  check (platform in ('instagram', 'tiktok', 'pinterest', 'youtube'));

create table if not exists public.activity_log (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  actor_name text not null,
  action text not null,
  created_at timestamptz not null default now()
);

alter table public.activity_log enable row level security;

drop policy if exists "Members can view activity log" on public.activity_log;
create policy "Members can view activity log" on public.activity_log for select to authenticated
  using (public.is_project_member(project_id));
drop policy if exists "Members can insert activity log" on public.activity_log;
create policy "Members can insert activity log" on public.activity_log for insert to authenticated
  with check (public.is_project_member(project_id));

-- profiles.email: synced from auth.users at signup from now on (handle_new_user
-- below), plus a one-time backfill for accounts that already existed.
alter table public.profiles
  add column if not exists email text;

update public.profiles p
set email = u.email
from auth.users u
where u.id = p.id and p.email is null;

create or replace function public.handle_new_user()
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

-- ---------- Notification bell (top nav) ----------
create table if not exists public.notifications (
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

drop policy if exists "Users can view their own notifications" on public.notifications;
create policy "Users can view their own notifications" on public.notifications for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Users can update their own notifications" on public.notifications;
create policy "Users can update their own notifications" on public.notifications for update to authenticated
  using (user_id = auth.uid());

drop policy if exists "Project members can create notifications for other members" on public.notifications;
create policy "Project members can create notifications for other members" on public.notifications for insert to authenticated
  with check (project_id is null or public.is_project_member(project_id));

-- ---------- Instagram/TikTok profile links (Overview edit mode) ----------
alter table public.projects
  add column if not exists instagram_url text not null default '',
  add column if not exists tiktok_url text not null default '';

-- ---------- Post scheduled time (Client PDF export) ----------
alter table public.posts
  add column if not exists scheduled_time time;

-- ---------- Brand Asset Collections (external folder links, e.g. Drive/Dropbox) ----------
create table if not exists public.asset_collections (
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

drop policy if exists "Members can view asset collections" on public.asset_collections;
create policy "Members can view asset collections" on public.asset_collections for select to authenticated
  using (public.is_project_member(project_id));

drop policy if exists "Admins manage asset collections" on public.asset_collections;
create policy "Admins manage asset collections" on public.asset_collections for all to authenticated
  using (public.project_role(project_id) in ('owner', 'admin'))
  with check (public.project_role(project_id) in ('owner', 'admin'));

-- ---------- Shared Client Preview (shareable, view-only links for Posts/Stories) ----------
create table if not exists public.share_links (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  token text not null unique,
  title text not null default '',
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create table if not exists public.share_link_items (
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

drop policy if exists "Members can view share links" on public.share_links;
create policy "Members can view share links" on public.share_links for select to authenticated
  using (public.is_project_member(project_id));
drop policy if exists "Admins manage share links" on public.share_links;
create policy "Admins manage share links" on public.share_links for all to authenticated
  using (public.project_role(project_id) in ('owner', 'admin'))
  with check (public.project_role(project_id) in ('owner', 'admin'));

drop policy if exists "Members can view share link items" on public.share_link_items;
create policy "Members can view share link items" on public.share_link_items for select to authenticated
  using (exists (
    select 1 from public.share_links sl
    where sl.id = share_link_id and public.is_project_member(sl.project_id)
  ));
drop policy if exists "Admins manage share link items" on public.share_link_items;
create policy "Admins manage share link items" on public.share_link_items for all to authenticated
  using (exists (
    select 1 from public.share_links sl
    where sl.id = share_link_id and public.project_role(sl.project_id) in ('owner', 'admin')
  ))
  with check (exists (
    select 1 from public.share_links sl
    where sl.id = share_link_id and public.project_role(sl.project_id) in ('owner', 'admin')
  ));

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

-- Client Review write-back (idempotent re-run): see schema.sql's own
-- comment on this block for the full reasoning -- the token itself is the
-- credential (no login), each function verifies a share_link_items row
-- actually connects this token to this post/story before writing.
create or replace function public.set_post_review_status_by_token(p_token text, p_post_id uuid, p_status text)
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

create or replace function public.set_story_review_status_by_token(p_token text, p_story_id uuid, p_status text)
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

create or replace function public.set_post_notes_by_token(p_token text, p_post_id uuid, p_notes text)
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

create or replace function public.set_story_notes_by_token(p_token text, p_story_id uuid, p_notes text)
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
create or replace function public.get_review_notify_context_by_token(p_token text, p_post_id uuid, p_story_id uuid)
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

drop policy if exists "Public can read media for active share links" on storage.objects;
create policy "Public can read media for active share links"
  on storage.objects for select
  to anon, authenticated
  using (
    bucket_id = 'project-media'
    and public.is_media_path_shared(storage.objects.name)
  );

-- ---------- Task Management (status/assignee/comments, shared visibility) ----------
alter table public.tasks add column if not exists status text not null default 'todo'
  check (status in ('todo', 'in_progress', 'done'));
alter table public.tasks add column if not exists assignee_id uuid references public.profiles (id) on delete set null;
alter table public.tasks add column if not exists updated_at timestamptz not null default now();

-- Backfill from the old boolean, guarded so a re-run of this script is a
-- no-op the second time (no row will ever again be status='todo' AND
-- completed=true once this has run once).
update public.tasks set status = 'done' where completed = true and status = 'todo';

-- `completed` is intentionally NOT dropped -- kept frozen/unused rather
-- than risking a destructive column drop in an append-only migration file.

create table if not exists public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  author_id uuid not null references public.profiles (id),
  text text not null,
  created_at timestamptz not null default now()
);
alter table public.task_comments enable row level security;

-- Visibility widens from "creator only" to "shared with the task's project
-- team" (mirrors Grid/Calendar/Brief's own is_project_member gating) --
-- tasks with no project stay creator-only, unchanged from before.
drop policy if exists "Users manage their own tasks" on public.tasks;
drop policy if exists "Members manage project tasks, users manage personal tasks" on public.tasks;
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

drop policy if exists "Task comment visibility follows task visibility" on public.task_comments;
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

-- ---------- Media folders (Media Library multi-select + bulk move) ----------
create table if not exists public.media_folders (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

alter table public.media_assets add column if not exists folder_id uuid references public.media_folders (id) on delete set null;

alter table public.media_folders enable row level security;

drop policy if exists "Members can view media folders" on public.media_folders;
create policy "Members can view media folders"
  on public.media_folders for select
  to authenticated
  using (public.is_project_member(project_id));

drop policy if exists "Admins manage media folders" on public.media_folders;
create policy "Admins manage media folders"
  on public.media_folders for all
  to authenticated
  using (public.project_role(project_id) in ('owner', 'admin'))
  with check (public.project_role(project_id) in ('owner', 'admin'));

-- ---------- Client Review Mode ----------
alter table public.posts add column if not exists review_status text not null default 'pending'
  check (review_status in ('pending', 'approved', 'changes_requested'));
alter table public.stories add column if not exists review_status text not null default 'pending'
  check (review_status in ('pending', 'approved', 'changes_requested'));

create table if not exists public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  author_id uuid not null references public.profiles (id),
  text text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.story_comments (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references public.stories (id) on delete cascade,
  author_id uuid not null references public.profiles (id),
  text text not null,
  created_at timestamptz not null default now()
);

alter table public.post_comments enable row level security;
alter table public.story_comments enable row level security;

drop policy if exists "Post comment visibility follows post visibility" on public.post_comments;
create policy "Post comment visibility follows post visibility"
  on public.post_comments for all to authenticated
  using (exists (select 1 from public.posts p where p.id = post_comments.post_id and public.is_project_member(p.project_id)))
  with check (
    author_id = auth.uid()
    and exists (select 1 from public.posts p where p.id = post_comments.post_id and public.is_project_member(p.project_id))
  );

drop policy if exists "Story comment visibility follows story visibility" on public.story_comments;
create policy "Story comment visibility follows story visibility"
  on public.story_comments for all to authenticated
  using (exists (select 1 from public.stories s where s.id = story_comments.story_id and public.is_project_member(s.project_id)))
  with check (
    author_id = auth.uid()
    and exists (select 1 from public.stories s where s.id = story_comments.story_id and public.is_project_member(s.project_id))
  );

create or replace function public.set_post_review_status(p_post_id uuid, p_status text)
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

create or replace function public.set_story_review_status(p_story_id uuid, p_status text)
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
alter table public.profiles add column if not exists is_admin boolean not null default false;

create table if not exists public.landing_demo_content (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.landing_demo_content enable row level security;

drop policy if exists "Anyone can read landing demo content" on public.landing_demo_content;
create policy "Anyone can read landing demo content"
  on public.landing_demo_content for select
  to anon, authenticated
  using (true);

drop policy if exists "Admins manage landing demo content" on public.landing_demo_content;
create policy "Admins manage landing demo content"
  on public.landing_demo_content for all
  to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and is_admin))
  with check (exists (select 1 from public.profiles where id = auth.uid() and is_admin));

insert into storage.buckets (id, name, public)
values ('landing-media', 'landing-media', true)
on conflict (id) do nothing;

drop policy if exists "Anyone can read landing media" on storage.objects;
create policy "Anyone can read landing media"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'landing-media');

drop policy if exists "Admins manage landing media" on storage.objects;
create policy "Admins manage landing media"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'landing-media' and exists (select 1 from public.profiles where id = auth.uid() and is_admin))
  with check (bucket_id = 'landing-media' and exists (select 1 from public.profiles where id = auth.uid() and is_admin));

-- AI Design Generation: purely cosmetic badge on a media_assets row created
-- by Brief's "Generate Design", never gates anything.
alter table public.media_assets
  add column if not exists generated_by_ai boolean not null default false;

-- Brand Moodboard: a project's permanent visual knowledge base, shown on the
-- Brief page and fed as context to "Generate Design". Files live in the
-- existing project-media bucket -- its storage policies already key on the
-- projectId path prefix, so no new bucket/storage policy is needed.
create table if not exists public.brand_moodboard_items (
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

drop policy if exists "Members can view brand moodboard" on public.brand_moodboard_items;
create policy "Members can view brand moodboard" on public.brand_moodboard_items for select to authenticated
  using (public.is_project_member(project_id));
drop policy if exists "Admins manage brand moodboard" on public.brand_moodboard_items;
create policy "Admins manage brand moodboard" on public.brand_moodboard_items for all to authenticated
  using (public.project_role(project_id) in ('owner', 'admin'))
  with check (public.project_role(project_id) in ('owner', 'admin'));

-- Force PostgREST to reload its schema cache so every change above (new
-- columns, tables, and the new RPC function) is picked up immediately.
notify pgrst, 'reload schema';
