-- ---------- Share Calendar: post/story Notes in the guest preview ----------
-- NOT YET RUN anywhere. Requires add_calendar_share_links.sql first.
-- Idempotent; safe to re-run.
--
-- Replaces get_shared_calendar with the same signature, permissions and
-- scoping, adding exactly two fields: posts.notes and stories.notes (the
-- Post/Story Editor's Notes box, which also holds Client Review feedback
-- and @mentions). Sharing them with link holders was explicitly approved
-- (2026-11-04). Everything else stays excluded: review status, story
-- names, comments, members, created_by, annotation data. No table,
-- policy, grant or storage change.

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
        'notes', po.notes,
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
        'notes', st.notes,
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
