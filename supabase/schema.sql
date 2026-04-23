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

create policy "profiles_select_own"
on public.profiles
for select
using (auth.uid() = id);

create policy "profiles_insert_own"
on public.profiles
for insert
with check (auth.uid() = id);

create policy "profiles_update_own"
on public.profiles
for update
using (auth.uid() = id)
with check (auth.uid() = id);

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

create policy "saved_friends_select_own"
on public.saved_friends
for select
using (auth.uid() = user_id);

create policy "saved_friends_insert_own"
on public.saved_friends
for insert
with check (auth.uid() = user_id);

create policy "saved_friends_update_own"
on public.saved_friends
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "saved_friends_delete_own"
on public.saved_friends
for delete
using (auth.uid() = user_id);
