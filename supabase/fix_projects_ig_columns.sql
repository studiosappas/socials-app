-- Fix: "Could not find the 'ig_display_name' column of 'projects' in the schema cache"
--
-- schema.sql already declares these columns, but the live database is missing them
-- (or PostgREST's schema cache is stale). This is idempotent — safe to run even if
-- some columns already exist. Run this once in the Supabase SQL editor.

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

-- Force PostgREST to reload its schema cache so it picks up the columns immediately
-- instead of waiting for its next automatic refresh.
notify pgrst, 'reload schema';
