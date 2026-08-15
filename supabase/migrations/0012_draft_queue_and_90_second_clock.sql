create table public.draft_queue (
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  player_id bigint not null references public.players(id) on delete cascade,
  priority smallint not null check (priority between 1 and 25),
  created_at timestamptz not null default now(),
  primary key (league_id, user_id, player_id),
  unique (league_id, user_id, priority)
);

create index draft_queue_player_idx on public.draft_queue(league_id, player_id);

alter table public.draft_queue enable row level security;
grant select on public.draft_queue to authenticated;

create policy "managers read own draft queue"
on public.draft_queue
for select
to authenticated
using (
  user_id = (select auth.uid())
  and (select private.is_league_member(league_id))
);

create or replace function public.set_draft_queue(
  p_league_id uuid,
  p_player_ids bigint[]
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_count integer := coalesce(cardinality(p_player_ids), 0);
  v_valid integer;
begin
  if v_user is null then
    raise exception 'Authentication required';
  end if;
  if not exists (
    select 1 from public.league_members
    where league_id = p_league_id and user_id = v_user
  ) then
    raise exception 'League membership required';
  end if;
  if v_count > 25 then
    raise exception 'Your draft queue can contain at most 25 players';
  end if;
  if v_count <> (
    select count(distinct item) from unnest(coalesce(p_player_ids, '{}'::bigint[])) as item
  ) then
    raise exception 'A player can only appear once in your queue';
  end if;

  select count(*) into v_valid
  from public.players p
  where p.id = any(coalesce(p_player_ids, '{}'::bigint[]))
    and p.active
    and not exists (
      select 1 from public.draft_picks dp
      where dp.league_id = p_league_id and dp.player_id = p.id
    );

  if v_valid <> v_count then
    raise exception 'Every queued player must be active and available';
  end if;

  delete from public.draft_queue
  where league_id = p_league_id and user_id = v_user;

  insert into public.draft_queue(league_id, user_id, player_id, priority)
  select p_league_id, v_user, item, ordinality::smallint
  from unnest(coalesce(p_player_ids, '{}'::bigint[])) with ordinality as queued(item, ordinality);
end
$$;

revoke all on function public.set_draft_queue(uuid, bigint[]) from public, anon;
grant execute on function public.set_draft_queue(uuid, bigint[]) to authenticated;

create or replace function private.remove_drafted_player_from_queues()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.draft_queue
  where league_id = new.league_id and player_id = new.player_id;
  return new;
end
$$;

revoke all on function private.remove_drafted_player_from_queues() from public, anon, authenticated;

create trigger remove_drafted_player_from_queues
after insert on public.draft_picks
for each row execute function private.remove_drafted_player_from_queues();

create or replace function private.perform_auto_pick(p_league_id uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_draft public.drafts%rowtype;
  v_n integer;
  v_round integer;
  v_index integer;
  v_slot integer;
  v_user uuid;
  v_player bigint;
  v_id bigint;
  v_gk integer;
  v_def integer;
  v_mid integer;
  v_fwd integer;
begin
  select * into v_draft
  from public.drafts
  where league_id = p_league_id
  for update;

  if not found or v_draft.status <> 'live' then raise exception 'Draft is not live'; end if;
  if v_draft.pick_deadline is null or now() <= v_draft.pick_deadline then raise exception 'Auto-pick is not due'; end if;

  select count(*) into v_n from public.league_members where league_id = p_league_id;
  v_round := ((v_draft.current_pick - 1) / v_n) + 1;
  v_index := ((v_draft.current_pick - 1) % v_n) + 1;
  v_slot := case when mod(v_round, 2) = 1 then v_index else v_n - v_index + 1 end;
  select user_id into v_user from public.league_members where league_id = p_league_id and draft_slot = v_slot;

  select
    count(*) filter (where p.position = 'GK'),
    count(*) filter (where p.position = 'DEF'),
    count(*) filter (where p.position = 'MID'),
    count(*) filter (where p.position = 'FWD')
  into v_gk, v_def, v_mid, v_fwd
  from public.draft_picks dp
  join public.players p on p.id = dp.player_id
  where dp.league_id = p_league_id and dp.user_id = v_user;

  select p.id into v_player
  from public.draft_queue q
  join public.players p on p.id = q.player_id
  where q.league_id = p_league_id and q.user_id = v_user and p.active
    and not exists (select 1 from public.draft_picks dp where dp.league_id = p_league_id and dp.player_id = p.id)
    and ((p.position = 'GK' and v_gk < 2) or (p.position = 'DEF' and v_def < 6) or (p.position = 'MID' and v_mid < 5) or (p.position = 'FWD' and v_fwd < 5))
  order by q.priority
  limit 1;

  if v_player is null then
    select p.id into v_player
    from public.players p
    where p.active
      and not exists (select 1 from public.draft_picks dp where dp.league_id = p_league_id and dp.player_id = p.id)
      and ((p.position = 'GK' and v_gk < 2) or (p.position = 'DEF' and v_def < 6) or (p.position = 'MID' and v_mid < 5) or (p.position = 'FWD' and v_fwd < 5))
    order by p.draft_rank nulls last, p.id
    limit 1;
  end if;

  if v_player is null then
    select p.id into v_player
    from public.players p
    where p.active and not exists (select 1 from public.draft_picks dp where dp.league_id = p_league_id and dp.player_id = p.id)
    order by p.draft_rank nulls last, p.id
    limit 1;
  end if;

  if v_player is null then
    update public.drafts set status = 'paused', pick_deadline = null, updated_at = now() where id = v_draft.id;
    return null;
  end if;

  insert into public.draft_picks(draft_id, league_id, pick_number, round, user_id, player_id, auto_picked)
  values (v_draft.id, p_league_id, v_draft.current_pick, v_round, v_user, v_player, true)
  returning id into v_id;

  update public.drafts
  set current_pick = current_pick + 1,
      status = case when current_pick >= v_n * 18 then 'complete'::public.draft_status else status end,
      pick_deadline = case when current_pick >= v_n * 18 then null else now() + make_interval(secs => pick_seconds) end,
      updated_at = now()
  where id = v_draft.id;
  return v_id;
end
$$;

revoke all on function private.perform_auto_pick(uuid) from public, anon, authenticated;

create or replace function public.start_draft(
  p_league_id uuid,
  p_pick_seconds smallint default 90
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_count integer;
  v_id uuid;
  v_status public.draft_status;
begin
  perform 1 from public.leagues where id = p_league_id and commissioner_id = v_user for update;
  if not found then raise exception 'Only the commissioner can start this draft'; end if;
  select id, status into v_id, v_status from public.drafts where league_id = p_league_id for update;
  if found then
    if v_status = 'live' then return v_id; end if;
    raise exception 'This draft already exists with status %', v_status;
  end if;
  select count(*) into v_count from public.league_members where league_id = p_league_id;
  if v_count < 3 then raise exception 'At least 3 managers are required before drafting'; end if;
  insert into public.drafts(league_id, status, pick_seconds, current_pick, pick_deadline, started_at)
  values (p_league_id, 'live', p_pick_seconds, 1, now() + make_interval(secs => p_pick_seconds), now())
  returning id into v_id;
  return v_id;
end
$$;

revoke all on function public.start_draft(uuid, smallint) from public, anon;
grant execute on function public.start_draft(uuid, smallint) to authenticated;

update public.drafts
set pick_seconds = 90,
    pick_deadline = case when status = 'live' then now() + interval '90 seconds' else pick_deadline end,
    updated_at = now()
where status in ('waiting', 'live', 'paused');
