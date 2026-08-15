create extension if not exists pg_cron;

alter table public.players
add column if not exists draft_rank integer;

with ranked as (
  select id, row_number() over (order by id)::integer as rank
  from public.players
  where active
)
update public.players p
set draft_rank = ranked.rank
from ranked
where p.id = ranked.id
  and p.draft_rank is null;

create unique index if not exists players_active_draft_rank_idx
on public.players(draft_rank)
where active and draft_rank is not null;

comment on column public.players.draft_rank is
  'Overall draft board rank; lower numbers are selected first by best-available auto-pick.';

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

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

  if not found or v_draft.status <> 'live' then
    raise exception 'Draft is not live';
  end if;
  if v_draft.pick_deadline is null or now() <= v_draft.pick_deadline then
    raise exception 'Auto-pick is not due';
  end if;

  select count(*) into v_n
  from public.league_members
  where league_id = p_league_id;

  v_round := ((v_draft.current_pick - 1) / v_n) + 1;
  v_index := ((v_draft.current_pick - 1) % v_n) + 1;
  v_slot := case when mod(v_round, 2) = 1 then v_index else v_n - v_index + 1 end;

  select user_id into v_user
  from public.league_members
  where league_id = p_league_id and draft_slot = v_slot;

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
  from public.players p
  where p.active
    and not exists (
      select 1 from public.draft_picks dp
      where dp.league_id = p_league_id and dp.player_id = p.id
    )
    and (
      (p.position = 'GK' and v_gk < 2)
      or (p.position = 'DEF' and v_def < 6)
      or (p.position = 'MID' and v_mid < 5)
      or (p.position = 'FWD' and v_fwd < 5)
    )
  order by p.draft_rank nulls last, p.id
  limit 1;

  if v_player is null then
    select p.id into v_player
    from public.players p
    where p.active
      and not exists (
        select 1 from public.draft_picks dp
        where dp.league_id = p_league_id and dp.player_id = p.id
      )
    order by p.draft_rank nulls last, p.id
    limit 1;
  end if;

  if v_player is null then
    update public.drafts
    set status = 'paused', pick_deadline = null, updated_at = now()
    where id = v_draft.id;
    return null;
  end if;

  insert into public.draft_picks(
    draft_id, league_id, pick_number, round, user_id, player_id, auto_picked
  ) values (
    v_draft.id, p_league_id, v_draft.current_pick, v_round, v_user, v_player, true
  ) returning id into v_id;

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

create or replace function public.auto_pick_draft(p_league_id uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
begin
  if not exists (
    select 1 from public.league_members
    where league_id = p_league_id and user_id = v_caller
  ) then
    raise exception 'League membership required';
  end if;
  return private.perform_auto_pick(p_league_id);
end
$$;

revoke all on function public.auto_pick_draft(uuid) from public, anon;
grant execute on function public.auto_pick_draft(uuid) to authenticated;

create or replace function private.process_expired_drafts()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_league_id uuid;
begin
  for v_league_id in
    select league_id from public.drafts
    where status = 'live' and pick_deadline <= now()
    order by pick_deadline
  loop
    begin
      perform private.perform_auto_pick(v_league_id);
    exception when others then
      raise warning 'Auto-pick failed for league %: %', v_league_id, sqlerrm;
    end;
  end loop;
end
$$;

revoke all on function private.process_expired_drafts() from public, anon, authenticated;

do $$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select jobid from cron.job where jobname = 'process-expired-fantasy-drafts'
  loop
    perform cron.unschedule(v_job_id);
  end loop;
end
$$;

select cron.schedule(
  'process-expired-fantasy-drafts',
  '10 seconds',
  $cron$select private.process_expired_drafts();$cron$
);
