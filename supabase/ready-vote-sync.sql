begin;

alter table public.meeting_rooms
add column if not exists draw_controller_id text,
add column if not exists draw_ready_ids jsonb not null default '[]'::jsonb,
add column if not exists redraw_votes jsonb not null default '[]'::jsonb,
add column if not exists redraw_requested_at timestamptz;

alter table public.profiles
add column if not exists gender text not null default 'unspecified',
add column if not exists avatar_url text;

alter table public.saved_friends
add column if not exists gender text not null default 'unspecified';

alter table public.meeting_room_participants
add column if not exists gender text not null default 'unspecified',
add column if not exists avatar_url text;

alter table public.meeting_rooms replica identity full;

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
      select coalesce(jsonb_agg(distinct vote_id), '[]'::jsonb)
      from (
        select jsonb_array_elements_text(coalesce(public.meeting_rooms.redraw_votes, '[]'::jsonb)) as vote_id
        union
        select voter_id as vote_id
      ) votes
      where vote_id is not null and length(trim(vote_id)) > 0
    ),
    redraw_requested_at = coalesce(public.meeting_rooms.redraw_requested_at, now()),
    updated_at = now()
  where id = target_room_id
  returning * into updated_room;

  return updated_room;
end;
$$;

grant execute on function public.set_room_draw_ready(uuid, text, boolean) to anon, authenticated;
grant execute on function public.request_room_redraw_vote(uuid, text) to anon, authenticated;

commit;
