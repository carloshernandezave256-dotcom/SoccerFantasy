-- No data activation, grants, RLS changes, or lineup/result writes.
-- CREATE OR REPLACE retains existing function ACLs and ownership.
alter table private.lineup_edit_exceptions
 add column if not exists allow_started_players boolean not null default false;

create or replace function private.exception_player_locked(p_league_id uuid,p_week smallint,p_player bigint)
returns boolean language sql stable set search_path='' as $$
 select case when p_week = private.lineup_exception_week(p_league_id)
 and exists(select 1 from private.lineup_edit_exceptions e
 where e.league_id=p_league_id and e.gameweek=p_week and e.allow_started_players)
 then false else not exists(
  select 1 from private.gameweek_fixture_members m
  join public.football_fixture_cache f using(fixture_id)
  join public.players p on p.id=p_player and p.competition=f.competition and p.club in(f.home_team,f.away_team)
  where m.league_id=p_league_id and m.gameweek=p_week
 ) or exists(
  select 1 from private.gameweek_fixture_members m
  join public.football_fixture_cache f using(fixture_id)
  join public.players p on p.id=p_player and p.competition=f.competition and p.club in(f.home_team,f.away_team)
  where m.league_id=p_league_id and m.gameweek=p_week
  and (least(m.original_kickoff,f.kickoff)<=statement_timestamp() or f.status not in('NS','TBD','PST'))
 )
 end
$$;

create or replace function public.lineup_player_lock_state(p_league_id uuid)
returns table(player_id bigint,locks_at timestamptz,locked boolean,rolling boolean,server_time timestamptz)
language plpgsql stable security definer set search_path='' as $$
declare v_week smallint; v_full_week boolean;
begin
 if not exists(select 1 from public.league_members where league_id=p_league_id and user_id=(select auth.uid())) then raise exception 'League membership required';end if;
 v_week:=private.lineup_exception_week(p_league_id);
 select coalesce(bool_or(e.allow_started_players),false) into v_full_week
 from private.lineup_edit_exceptions e where e.league_id=p_league_id and e.gameweek=v_week;
 return query
 select p.id,
  case when v_full_week then null::timestamptz when v_week is not null then (
   select min(least(m.original_kickoff,f.kickoff)) from private.gameweek_fixture_members m
   join public.football_fixture_cache f using(fixture_id)
   where m.league_id=p_league_id and m.gameweek=v_week and f.competition=p.competition and p.club in(f.home_team,f.away_team)
  ) else (select w.roster_lock_at from public.league_transaction_windows w where w.league_id=p_league_id order by w.gameweek desc limit 1) end,
  case when v_week is not null then private.exception_player_locked(p_league_id,v_week,p.id) else private.lineup_changes_locked(p_league_id) end,
  (v_week is not null and not v_full_week),statement_timestamp()
 from public.players p where p.id in (
  select l.player_id from public.lineup_players l where l.league_id=p_league_id
  union select d.player_id from public.draft_picks d where d.league_id=p_league_id
  union select c.player_id from public.pack_cards c where c.league_id=p_league_id and c.active_slot is not null
 );
end $$;
CREATE OR REPLACE FUNCTION public.lineup_lock_state(p_league_id uuid)
 RETURNS TABLE(gameweek integer, locks_at timestamp with time zone, reopens_after timestamp with time zone, locked boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not exists(select 1 from public.league_members where league_id=p_league_id and user_id=(select auth.uid())) then
    raise exception 'League membership required';
  end if;
  return query
  select w.gameweek,
    case when exists(select 1 from private.lineup_edit_exceptions e
      where e.league_id=p_league_id and e.gameweek=private.lineup_exception_week(p_league_id)
      and e.allow_started_players) then null::timestamptz else w.roster_lock_at end,
    max(f.original_kickoff),(private.lineup_changes_locked(p_league_id) and private.lineup_exception_week(p_league_id) is null)
  from public.league_transaction_windows w
  left join private.gameweek_fixture_members f on f.league_id=w.league_id and f.gameweek=w.gameweek
  where w.league_id=p_league_id
  group by w.gameweek,w.roster_lock_at
  order by w.gameweek desc limit 1;
end;
$function$;


-- Only function bodies change. Existing ACLs, ownership, RLS and base-lock helper are retained.
create or replace function public.initialize_default_lineup(
  p_league_id uuid,
  p_starters bigint[],
  p_bench bigint[]
) returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare v_full_week smallint;
  v_user uuid := (select auth.uid());
  v_format text;
  v_gk integer;
  v_def integer;
  v_mid integer;
  v_fwd integer;
  v_existing integer;
  v_owned integer;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select league.game_format into v_format
  from public.league_members member
  join public.leagues league on league.id = member.league_id
  where member.league_id = p_league_id and member.user_id = v_user;
  if v_format is null then raise exception 'League membership required'; end if;

  -- Only the explicitly flagged, active full-week exception permits these paths.
  select e.gameweek into v_full_week from private.lineup_edit_exceptions e
  where e.league_id=p_league_id and e.gameweek=private.lineup_exception_week(p_league_id)
    and e.allow_started_players;
  if v_full_week is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_league_id::text||':'||v_full_week::text,0));
    if private.lineup_exception_week(p_league_id) is distinct from v_full_week
      or not exists(select 1 from private.lineup_edit_exceptions e
        where e.league_id=p_league_id and e.gameweek=v_full_week and e.allow_started_players)
    then raise exception 'This week’s lineup exception has ended'; end if;
  end if;
  if private.lineup_changes_locked(p_league_id) and v_full_week is null then
    raise exception 'Your full lineup is locked until every fixture in this gameweek is final';
  end if;

  -- Page load may call this initializer automatically. Never replace existing choices
  -- during the full-week exception, even if the current XI is incomplete.
  if v_full_week is not null and exists(select 1 from public.lineup_players
    where league_id=p_league_id and user_id=v_user) then return false; end if;

  select
    count(*) filter (where lineup.is_starter),
    count(*) filter (where lineup.is_starter and player.position = 'GK'),
    count(*) filter (where lineup.is_starter and player.position = 'DEF'),
    count(*) filter (where lineup.is_starter and player.position = 'MID'),
    count(*) filter (where lineup.is_starter and player.position = 'FWD')
  into v_existing, v_gk, v_def, v_mid, v_fwd
  from public.lineup_players lineup
  join public.players player on player.id = lineup.player_id
  where lineup.league_id = p_league_id and lineup.user_id = v_user;
  if v_existing = 11 and v_gk = 1 and v_def >= 3 and v_mid >= 1 and v_fwd between 1 and 4 then
    return false;
  end if;

  if cardinality(p_starters) <> 11 or cardinality(p_bench) > 7 then
    raise exception 'Default lineup requires 11 starters and at most 7 bench players';
  end if;
  if cardinality(p_starters || p_bench) <> cardinality(array(select distinct unnest(p_starters || p_bench))) then
    raise exception 'A player cannot occupy two lineup slots';
  end if;
  if exists (select 1 from public.players where id = any(p_starters) and injured) then
    raise exception 'Injured, suspended, or unavailable players cannot start';
  end if;

  select
    count(*) filter (where position = 'GK'),
    count(*) filter (where position = 'DEF'),
    count(*) filter (where position = 'MID'),
    count(*) filter (where position = 'FWD')
  into v_gk, v_def, v_mid, v_fwd
  from public.players where id = any(p_starters);
  if v_gk <> 1 or v_def <> 4 or v_mid <> 3 or v_fwd <> 3 then
    raise exception 'The automatic lineup must be a 4-3-3 with exactly one goalkeeper';
  end if;

  if v_format = 'pack' then
    select count(distinct player_id) into v_owned
    from public.pack_cards
    where league_id = p_league_id and user_id = v_user
      and active_slot is not null and player_id = any(p_starters || p_bench);
  else
    select count(*) into v_owned
    from public.draft_picks
    where league_id = p_league_id and user_id = v_user
      and player_id = any(p_starters || p_bench);
  end if;
  if v_owned <> cardinality(p_starters || p_bench) then
    raise exception 'Every default lineup player must be in your active squad';
  end if;

  delete from public.lineup_players
  where league_id = p_league_id and user_id = v_user;
  insert into public.lineup_players (
    league_id, user_id, player_id, is_starter, is_captain, pitch_order
  ) select p_league_id, v_user, player_id, true, false, ordinal
    from unnest(p_starters) with ordinality starter(player_id, ordinal);
  insert into public.lineup_players (
    league_id, user_id, player_id, is_starter, is_captain, bench_order
  ) select p_league_id, v_user, player_id, false, false, ordinal
    from unnest(p_bench) with ordinality bench(player_id, ordinal);
  if v_full_week is not null then perform private.sync_exception_lineup(p_league_id,v_user); end if;
  return true;
end;
$function$;

create or replace function public.save_partial_pitch_order(p_league_id uuid,p_players bigint[])
returns void language plpgsql security definer set search_path='' as $$
declare v_full_week smallint; v_user uuid:=(select auth.uid());v_format text;v_owned integer;
begin
  if v_user is null then raise exception 'Authentication required';end if;
  if cardinality(p_players)<1 or cardinality(p_players)>11 or cardinality(p_players)<>cardinality(array(select distinct unnest(p_players))) then raise exception 'Pitch order requires 1 to 11 unique players';end if;
  select l.game_format into v_format from public.league_members m join public.leagues l on l.id=m.league_id where m.league_id=p_league_id and m.user_id=v_user;
  if v_format is null then raise exception 'League membership required';end if;

  -- Only the explicitly flagged, active full-week exception permits these paths.
  select e.gameweek into v_full_week from private.lineup_edit_exceptions e
  where e.league_id=p_league_id and e.gameweek=private.lineup_exception_week(p_league_id)
    and e.allow_started_players;
  if v_full_week is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_league_id::text||':'||v_full_week::text,0));
    if private.lineup_exception_week(p_league_id) is distinct from v_full_week
      or not exists(select 1 from private.lineup_edit_exceptions e
        where e.league_id=p_league_id and e.gameweek=v_full_week and e.allow_started_players)
    then raise exception 'This week’s lineup exception has ended'; end if;
  end if;
  if private.lineup_changes_locked(p_league_id) and v_full_week is null then raise exception 'Your full lineup is locked until every fixture in this gameweek is final';end if;
  if v_format='pack' then
    select count(distinct player_id) into v_owned from public.pack_cards where league_id=p_league_id and user_id=v_user and active_slot is not null and player_id=any(p_players);
  else
    select count(*) into v_owned from public.draft_picks where league_id=p_league_id and user_id=v_user and player_id=any(p_players);
  end if;
  if v_owned<>cardinality(p_players) then raise exception 'Every arranged player must be in your active roster';end if;
  update public.lineup_players set pitch_order=null where league_id=p_league_id and user_id=v_user;
  insert into public.lineup_players(league_id,user_id,player_id,is_starter,is_captain,bench_order,pitch_order)
  select p_league_id,v_user,x,true,false,null,ord from unnest(p_players) with ordinality s(x,ord)
  on conflict(league_id,user_id,player_id) do update set is_starter=true,bench_order=null,pitch_order=excluded.pitch_order,updated_at=now();
  if v_full_week is not null then perform private.sync_exception_lineup(p_league_id,v_user); end if;
end$$;
