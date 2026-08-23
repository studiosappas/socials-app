-- Internal Admin Dashboard: schema additions.
-- Run this in the Supabase SQL editor. Idempotent (safe to re-run), matches
-- the style of the other fix_*_schema.sql files in this directory.

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
