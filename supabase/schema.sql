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
  location_source text,
  created_at timestamptz not null default now()
);

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
  selected_category text not null default 'dining',
  selected_candidate jsonb,
  status text not null default 'planning',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists meeting_rooms_code_idx on public.meeting_rooms (code);

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

create table if not exists public.meeting_room_participants (
  id text primary key,
  room_id uuid not null references public.meeting_rooms(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  name text not null,
  location text not null,
  latitude double precision not null,
  longitude double precision not null,
  max_travel_time integer not null default 45,
  location_source text,
  saved_friend_id text,
  created_at timestamptz not null default now()
);

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
