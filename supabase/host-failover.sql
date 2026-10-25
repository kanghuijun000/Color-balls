-- Color-balls: secure host heartbeat and failover
-- Run this entire file once in Supabase SQL Editor.
alter table public.cb_rooms
  add column if not exists host_seen_at timestamptz;

update public.cb_rooms
set host_seen_at = coalesce(host_seen_at, created_at, now())
where host_seen_at is null;

create or replace function public.cb_host_heartbeat(p_room_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seen timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  update public.cb_rooms
  set host_seen_at = now()
  where id = p_room_id
    and host_id = auth.uid()
    and status = 'playing'
  returning host_seen_at into v_seen;

  if v_seen is null then
    raise exception 'Only the current host of a playing room can send heartbeat';
  end if;

  return v_seen;
end;
$$;

create or replace function public.cb_try_host_transfer(p_room_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_new_host uuid;
begin
  if v_user is null then
    raise exception 'Authentication required';
  end if;

  -- Only a current room participant can attempt to take over.
  if not exists (
    select 1 from public.cb_players p
    where p.room_id = p_room_id
      and p.player_id = v_user
      and p.status <> 'left'
  ) then
    raise exception 'Only a room participant can request host transfer';
  end if;

  -- Atomic compare-and-set: exactly one participant can take over after
  -- the current host has stopped heartbeating for 8 seconds.
  update public.cb_rooms r
  set host_id = v_user,
      host_seen_at = now()
  where r.id = p_room_id
    and r.status = 'playing'
    and r.host_id <> v_user
    and coalesce(r.host_seen_at, r.created_at) < now() - interval '8 seconds'
    and exists (
      select 1 from public.cb_players p
      where p.room_id = r.id
        and p.player_id = v_user
        and p.status <> 'left'
    )
  returning r.host_id into v_new_host;

  return v_new_host;
end;
$$;

revoke all on function public.cb_host_heartbeat(uuid) from public;
revoke all on function public.cb_try_host_transfer(uuid) from public;
grant execute on function public.cb_host_heartbeat(uuid) to authenticated;
grant execute on function public.cb_try_host_transfer(uuid) to authenticated;
