-- Pathway Demo: run this in Supabase SQL Editor
-- Project Settings → Authentication → Providers: enable Email

create table if not exists public.roadmaps (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  updated_at timestamptz not null default now(),
  nodes jsonb not null default '[]'::jsonb,
  edges jsonb not null default '[]'::jsonb
);

create index if not exists roadmaps_user_id_idx on public.roadmaps (user_id);

create table if not exists public.daily_logs (
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  tasks jsonb not null default '[]'::jsonb,
  active_goal_ids jsonb,
  reflection text,
  primary key (user_id, date)
);

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  routine_tasks jsonb not null default '[]'::jsonb,
  assigned_roadmap_id uuid
);

alter table public.roadmaps enable row level security;
alter table public.daily_logs enable row level security;
alter table public.user_settings enable row level security;

drop policy if exists "roadmaps_select_own" on public.roadmaps;
drop policy if exists "roadmaps_insert_own" on public.roadmaps;
drop policy if exists "roadmaps_update_own" on public.roadmaps;
drop policy if exists "roadmaps_delete_own" on public.roadmaps;

create policy "roadmaps_select_own" on public.roadmaps
  for select using (auth.uid() = user_id);
create policy "roadmaps_insert_own" on public.roadmaps
  for insert with check (auth.uid() = user_id);
create policy "roadmaps_update_own" on public.roadmaps
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "roadmaps_delete_own" on public.roadmaps
  for delete using (auth.uid() = user_id);

drop policy if exists "daily_logs_select_own" on public.daily_logs;
drop policy if exists "daily_logs_insert_own" on public.daily_logs;
drop policy if exists "daily_logs_update_own" on public.daily_logs;
drop policy if exists "daily_logs_delete_own" on public.daily_logs;

create policy "daily_logs_select_own" on public.daily_logs
  for select using (auth.uid() = user_id);
create policy "daily_logs_insert_own" on public.daily_logs
  for insert with check (auth.uid() = user_id);
create policy "daily_logs_update_own" on public.daily_logs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "daily_logs_delete_own" on public.daily_logs
  for delete using (auth.uid() = user_id);

drop policy if exists "user_settings_select_own" on public.user_settings;
drop policy if exists "user_settings_insert_own" on public.user_settings;
drop policy if exists "user_settings_update_own" on public.user_settings;
drop policy if exists "user_settings_delete_own" on public.user_settings;

create policy "user_settings_select_own" on public.user_settings
  for select using (auth.uid() = user_id);
create policy "user_settings_insert_own" on public.user_settings
  for insert with check (auth.uid() = user_id);
create policy "user_settings_update_own" on public.user_settings
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "user_settings_delete_own" on public.user_settings
  for delete using (auth.uid() = user_id);
