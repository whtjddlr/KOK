create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text not null,
  favorite_categories text[] not null default array['restaurant', 'cafe']::text[],
  vibe text not null default 'trendy',
  favorite_keywords text[] not null default array['맛집', '카페']::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_email_idx on public.profiles (email);

alter table public.profiles
add column if not exists home_location text,
add column if not exists home_latitude double precision,
add column if not exists home_longitude double precision,
add column if not exists home_location_source text,
add column if not exists gender text not null default 'unspecified',
add column if not exists avatar_url text;

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles
for select
using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles
for insert
with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles
for update
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "profiles_delete_own" on public.profiles;
create policy "profiles_delete_own"
on public.profiles
for delete
using (auth.uid() = id);

create table if not exists public.saved_friends (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  location text not null,
  latitude double precision not null,
  longitude double precision not null,
  max_travel_time integer not null default 45,
  travel_mode text not null default 'transit',
  location_source text,
  created_at timestamptz not null default now()
);

alter table public.saved_friends
add column if not exists travel_mode text not null default 'transit',
add column if not exists gender text not null default 'unspecified';

create index if not exists saved_friends_user_id_idx on public.saved_friends (user_id);

alter table public.saved_friends enable row level security;

drop policy if exists "saved_friends_select_own" on public.saved_friends;
create policy "saved_friends_select_own"
on public.saved_friends
for select
using (auth.uid() = user_id);

drop policy if exists "saved_friends_insert_own" on public.saved_friends;
create policy "saved_friends_insert_own"
on public.saved_friends
for insert
with check (auth.uid() = user_id);

drop policy if exists "saved_friends_update_own" on public.saved_friends;
create policy "saved_friends_update_own"
on public.saved_friends
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "saved_friends_delete_own" on public.saved_friends;
create policy "saved_friends_delete_own"
on public.saved_friends
for delete
using (auth.uid() = user_id);

create table if not exists public.meeting_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  owner_id uuid references auth.users(id) on delete set null,
  draw_controller_id text,
  draw_ready_ids jsonb not null default '[]'::jsonb,
  redraw_votes jsonb not null default '[]'::jsonb,
  redraw_requested_at timestamptz,
  selected_category text not null default 'dining',
  selected_candidate jsonb,
  status text not null default 'planning',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists meeting_rooms_code_idx on public.meeting_rooms (code);

alter table public.meeting_rooms
add column if not exists draw_controller_id text,
add column if not exists draw_ready_ids jsonb not null default '[]'::jsonb,
add column if not exists redraw_votes jsonb not null default '[]'::jsonb,
add column if not exists redraw_requested_at timestamptz;

alter table public.meeting_rooms replica identity full;

alter table public.meeting_rooms enable row level security;

drop policy if exists "meeting_rooms_select_public" on public.meeting_rooms;
create policy "meeting_rooms_select_public"
on public.meeting_rooms
for select
using (true);

drop policy if exists "meeting_rooms_insert_public" on public.meeting_rooms;
create policy "meeting_rooms_insert_public"
on public.meeting_rooms
for insert
with check (true);

drop policy if exists "meeting_rooms_update_public" on public.meeting_rooms;
create policy "meeting_rooms_update_public"
on public.meeting_rooms
for update
using (true)
with check (true);

drop policy if exists "meeting_rooms_delete_own" on public.meeting_rooms;
create policy "meeting_rooms_delete_own"
on public.meeting_rooms
for delete
using (auth.uid() = owner_id);

create table if not exists public.meeting_room_participants (
  id text primary key,
  room_id uuid not null references public.meeting_rooms(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  name text not null,
  location text not null,
  latitude double precision not null,
  longitude double precision not null,
  max_travel_time integer not null default 45,
  travel_mode text not null default 'transit',
  location_source text,
  saved_friend_id text,
  created_at timestamptz not null default now()
);

alter table public.meeting_room_participants
add column if not exists travel_mode text not null default 'transit',
add column if not exists gender text not null default 'unspecified',
add column if not exists avatar_url text;

create index if not exists meeting_room_participants_room_id_idx
on public.meeting_room_participants (room_id, created_at);

alter table public.meeting_room_participants enable row level security;

drop policy if exists "meeting_room_participants_select_public" on public.meeting_room_participants;
create policy "meeting_room_participants_select_public"
on public.meeting_room_participants
for select
using (true);

drop policy if exists "meeting_room_participants_insert_public" on public.meeting_room_participants;
create policy "meeting_room_participants_insert_public"
on public.meeting_room_participants
for insert
with check (true);

drop policy if exists "meeting_room_participants_update_public" on public.meeting_room_participants;
create policy "meeting_room_participants_update_public"
on public.meeting_room_participants
for update
using (true)
with check (true);

drop policy if exists "meeting_room_participants_delete_public" on public.meeting_room_participants;
create policy "meeting_room_participants_delete_public"
on public.meeting_room_participants
for delete
using (true);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.meeting_rooms;
  end if;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.meeting_room_participants;
  end if;
exception
  when duplicate_object then null;
end $$;

create or replace function public.request_room_redraw_vote(
  target_room_id uuid,
  voter_id text
)
returns public.meeting_rooms
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_room public.meeting_rooms;
begin
  update public.meeting_rooms
  set
    redraw_votes = (
      select coalesce(jsonb_agg(distinct vote), '[]'::jsonb)
      from (
        select jsonb_array_elements_text(coalesce(public.meeting_rooms.redraw_votes, '[]'::jsonb)) as vote
        union
        select voter_id as vote
      ) votes
      where vote is not null and length(trim(vote)) > 0
    ),
    redraw_requested_at = coalesce(public.meeting_rooms.redraw_requested_at, now()),
    updated_at = now()
  where id = target_room_id
  returning * into updated_room;

  return updated_room;
end;
$$;

grant execute on function public.request_room_redraw_vote(uuid, text) to anon, authenticated;

create or replace function public.set_room_draw_ready(
  target_room_id uuid,
  actor_id text,
  is_ready boolean
)
returns public.meeting_rooms
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_room public.meeting_rooms;
begin
  update public.meeting_rooms
  set
    draw_ready_ids = case
      when is_ready then (
        select coalesce(jsonb_agg(distinct ready_id), '[]'::jsonb)
        from (
          select jsonb_array_elements_text(coalesce(public.meeting_rooms.draw_ready_ids, '[]'::jsonb)) as ready_id
          union
          select actor_id as ready_id
        ) ready_ids
        where ready_id is not null and length(trim(ready_id)) > 0
      )
      else (
        select coalesce(jsonb_agg(ready_id), '[]'::jsonb)
        from (
          select distinct jsonb_array_elements_text(coalesce(public.meeting_rooms.draw_ready_ids, '[]'::jsonb)) as ready_id
        ) ready_ids
        where ready_id <> actor_id
      )
    end,
    updated_at = now()
  where id = target_room_id
  returning * into updated_room;

  return updated_room;
end;
$$;

grant execute on function public.set_room_draw_ready(uuid, text, boolean) to anon, authenticated;
