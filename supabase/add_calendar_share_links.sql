-- ---------- Share Calendar: revocable, read-only guest calendar links ----------
-- NOT YET RUN anywhere. Idempotent; safe to re-run.
--
-- A separate table from share_links on purpose: share_links is listed in
-- Grid/Stories' "Manage Review Links" and is readable by every project
-- member, and its anon storage policy (is_media_path_shared) opens every
-- shared path to any anonymous caller. A calendar link exposes the whole
-- dated calendar, so:
--   * only owner/admin can see, create or revoke one (RLS below);
--   * anon gets NO table access at all -- the only way in is
--     get_shared_calendar(token, month), which derives the project from the
--     token alone and returns one month of display data;
--   * NO storage policy is added. Media URLs are signed server-side (Next.js,
--     service role) only for the paths this function just returned for a
--     valid token -- the token never grants storage access by itself.
-- Revoking = deleting the row; the link stops working immediately.

create table if not exists public.calendar_share_links (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  -- 32 random bytes, base64url (43 chars), generated server-side
  -- (src/lib/actions/calendar-share-links.ts) -- 256 bits, unguessable.
  token text not null unique check (token ~ '^[A-Za-z0-9_-]{43}$'),
  -- The creator's Week Starts On at creation time, so the guest sees the
  -- same week layout the team does.
  week_starts_on smallint not null default 0 check (week_starts_on in (0, 1)),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create index if not exists calendar_share_links_project_idx on public.calendar_share_links (project_id);

alter table public.calendar_share_links enable row level security;

drop policy if exists "Admins view calendar share links" on public.calendar_share_links;
create policy "Admins view calendar share links" on public.calendar_share_links for select to authenticated
  using (public.project_role(project_id) in ('owner', 'admin'));
drop policy if exists "Admins create calendar share links" on public.calendar_share_links;
create policy "Admins create calendar share links" on public.calendar_share_links for insert to authenticated
  with check (public.project_role(project_id) in ('owner', 'admin') and created_by = auth.uid());
drop policy if exists "Admins revoke calendar share links" on public.calendar_share_links;
create policy "Admins revoke calendar share links" on public.calendar_share_links for delete to authenticated
  using (public.project_role(project_id) in ('owner', 'admin'));
-- No update policy: a link is never edited, only created or revoked.

-- This database does not auto-grant table privileges (see the Staging setup
-- gotcha) -- explicit, and deliberately nothing for anon.
revoke all on public.calendar_share_links from anon;
grant select, insert, delete on public.calendar_share_links to authenticated;

-- One month of a shared calendar. Returns null for an unknown/revoked token
-- or an archived project. Only display fields: no internal notes, review
-- notes, comments, members, story names or anything outside this project.
-- "published" is computed (scheduled + date passed), never written -- the
-- team Calendar's own auto-publish UPDATE is not run for a guest.
create or replace function public.get_shared_calendar(p_token text, p_month date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_link record;
  v_month_start date;
  v_month_end date;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' or p_month is null then
    return null;
  end if;

  select l.project_id, l.week_starts_on, p.name
  into v_link
  from calendar_share_links l
  join projects p on p.id = l.project_id
  where l.token = p_token and p.archived = false;

  if v_link.project_id is null then
    return null;
  end if;

  v_month_start := date_trunc('month', p_month)::date;
  v_month_end := (v_month_start + interval '1 month' - interval '1 day')::date;

  return jsonb_build_object(
    'projectId', v_link.project_id,
    'projectName', v_link.name,
    'weekStartsOn', v_link.week_starts_on,
    'posts', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', po.id,
        'date', po.scheduled_date,
        'postType', po.post_type,
        'status', case when po.status = 'scheduled' and po.scheduled_date <= current_date then 'published' else po.status end,
        'caption', po.caption,
        'media', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'mediaType', ma.media_type,
            'storagePath', ma.storage_path,
            'posterStoragePath', ma.poster_storage_path
          ) order by pa.position), '[]'::jsonb)
          from post_assets pa
          join media_assets ma on ma.id = pa.media_asset_id
          where pa.post_id = po.id
        )
      ) order by po.scheduled_date, po.created_at), '[]'::jsonb)
      from posts po
      where po.project_id = v_link.project_id
        and po.scheduled_date between v_month_start and v_month_end
    ),
    'stories', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', st.id,
        'date', st.scheduled_date,
        'status', case when st.status = 'scheduled' and st.scheduled_date <= current_date then 'published' else st.status end,
        'media', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'mediaType', ma.media_type,
            'storagePath', ma.storage_path,
            'posterStoragePath', ma.poster_storage_path
          ) order by sf.position), '[]'::jsonb)
          from story_frames sf
          join media_assets ma on ma.id = sf.media_asset_id
          where sf.story_id = st.id
        )
      ) order by st.scheduled_date, st.created_at), '[]'::jsonb)
      from stories st
      where st.project_id = v_link.project_id
        and st.scheduled_date between v_month_start and v_month_end
    ),
    -- Day notes for the whole visible grid (up to 6 days either side).
    'notes', (
      select coalesce(jsonb_agg(jsonb_build_object('date', n.date, 'body', n.body)), '[]'::jsonb)
      from calendar_notes n
      where n.project_id = v_link.project_id
        and n.date between v_month_start - 6 and v_month_end + 6
    )
  );
end;
$$;

revoke all on function public.get_shared_calendar(text, date) from public;
grant execute on function public.get_shared_calendar(text, date) to anon, authenticated;
