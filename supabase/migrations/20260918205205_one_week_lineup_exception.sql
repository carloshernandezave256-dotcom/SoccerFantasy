
-- Temporary rolling lineup edits, explicitly enabled per league and gameweek.
create table private.lineup_edit_exceptions (
 league_id uuid not null references public.leagues(id) on delete cascade,
 gameweek smallint not null,
 expires_at timestamptz not null,
 primary key (league_id,gameweek)
);
alter table private.lineup_edit_exceptions enable row level security;
revoke all on private.lineup_edit_exceptions from public,anon,authenticated;

create function private.lineup_exception_week(p_league_id uuid)
returns smallint language sql stable security definer set search_path='' as $$
 select e.gameweek from private.lineup_edit_exceptions e
 join public.league_transaction_windows w using(league_id,gameweek)
 where e.league_id=p_league_id and statement_timestamp()<e.expires_at
 and statement_timestamp()>=w.roster_lock_at
 and e.gameweek=(select max(gameweek) from public.league_transaction_windows where league_id=p_league_id)
 and not exists(select 1 from public.finalized_gameweek_locks f where f.league_id=e.league_id and f.gameweek=e.gameweek)
$$;

create function private.exception_player_locked(p_league_id uuid,p_week smallint,p_player bigint)
returns boolean language sql stable set search_path='' as $$
 select not exists(
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
$$;

create function private.validate_exception_lineup(p_league_id uuid,p_user uuid,p_starters bigint[],p_bench bigint[],p_captain bigint)
returns void language plpgsql set search_path='' as $$
declare v_week smallint; v_player bigint;
begin
 v_week:=private.lineup_exception_week(p_league_id);
 if v_week is null then return; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_league_id::text||':'||v_week::text,0));
 -- The same gameweek lock serializes edits with publication and finalization.
 if private.lineup_exception_week(p_league_id) is null then raise exception 'This week’s lineup exception has ended'; end if;
 if p_user is null or not exists(select 1 from public.league_members where league_id=p_league_id and user_id=p_user) then raise exception 'League membership required'; end if;
 if p_starters is null or p_bench is null or p_captain is null
 or array_position(p_starters||p_bench,null) is not null then raise exception 'A complete lineup and Captain are required'; end if;
 for v_player in
  select s.player_id from public.lineup_gameweek_players s
  where s.league_id=p_league_id and s.gameweek=v_week and s.user_id=p_user
   and private.exception_player_locked(p_league_id,v_week,s.player_id)
   and (s.is_starter is distinct from (s.player_id=any(p_starters))
    or s.is_star_pick is distinct from (s.player_id=p_captain)
    or (s.is_starter and s.pitch_order is distinct from array_position(p_starters,s.player_id))
    or (not s.is_starter and s.bench_order is distinct from array_position(p_bench,s.player_id)))
 loop
  raise exception '% is locked because their match has started. Keep their existing position, Captain status and bench priority.',
   (select full_name from public.players where id=v_player);
 end loop;
 if exists(select 1 from unnest(p_starters||p_bench) a(id)
  where private.exception_player_locked(p_league_id,v_week,a.id)
  and not exists(select 1 from public.lineup_gameweek_players s where s.league_id=p_league_id and s.gameweek=v_week and s.user_id=p_user and s.player_id=a.id))
 then raise exception 'Players whose matches have started cannot be added'; end if;
end $$;

create function private.sync_exception_lineup(p_league_id uuid,p_user uuid)
returns void language plpgsql set search_path='' as $$
declare v_week smallint:=private.lineup_exception_week(p_league_id);
begin
 if v_week is null then return; end if;
 -- Validation already protected every started player; persist the exact saved lineup.
 delete from public.lineup_gameweek_players
 where league_id=p_league_id and gameweek=v_week and user_id=p_user
 and not private.exception_player_locked(p_league_id,v_week,player_id);
 insert into public.lineup_gameweek_players(league_id,gameweek,user_id,player_id,is_starter,is_star_pick,pitch_order,bench_order,captured_at)
 select league_id,v_week,user_id,player_id,is_starter,is_captain,pitch_order,bench_order,now()
 from public.lineup_players where league_id=p_league_id and user_id=p_user
 and not private.exception_player_locked(p_league_id,v_week,player_id);
end $$;
revoke all on function private.lineup_exception_week(uuid),private.exception_player_locked(uuid,smallint,bigint),private.validate_exception_lineup(uuid,uuid,bigint[],bigint[],bigint),private.sync_exception_lineup(uuid,uuid) from public,anon,authenticated;
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
  select w.gameweek,w.roster_lock_at,max(f.original_kickoff),(private.lineup_changes_locked(p_league_id) and private.lineup_exception_week(p_league_id) is null)
  from public.league_transaction_windows w
  left join private.gameweek_fixture_members f on f.league_id=w.league_id and f.gameweek=w.gameweek
  where w.league_id=p_league_id
  group by w.gameweek,w.roster_lock_at
  order by w.gameweek desc limit 1;
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_lineup(p_league_id uuid, p_starters bigint[], p_bench bigint[], p_captain bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := (select auth.uid());
  v_gk integer;
  v_def integer;
  v_mid integer;
  v_fwd integer;
  v_owned integer;
  v_format text;
begin
  perform private.validate_exception_lineup(p_league_id,v_user,p_starters,p_bench,p_captain);
  select league.game_format into v_format
  from public.league_members member
  join public.leagues league on league.id = member.league_id
  where member.league_id = p_league_id and member.user_id = v_user;
  if v_format is null then raise exception 'League membership required'; end if;
  if private.lineup_changes_locked(p_league_id) and private.lineup_exception_week(p_league_id) is null then
    raise exception 'Your full lineup is locked until every fixture in this gameweek is final';
  end if;
  if cardinality(p_starters) <> 11 then raise exception 'A starting lineup requires exactly 11 players'; end if;
  if cardinality(p_bench) > 7 then raise exception 'The bench allows at most 7 players'; end if;
  if not p_captain = any(p_starters) then raise exception 'Your captain must be in the starting XI'; end if;
  if cardinality(p_starters || p_bench) <> cardinality(array(select distinct unnest(p_starters || p_bench))) then
    raise exception 'A player cannot occupy two lineup slots';
  end if;
  if exists (select 1 from public.players where id = any(p_starters) and injured) then
    raise exception 'Injured, suspended, or unavailable players cannot start';
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
    raise exception 'Every lineup player must be in your active squad';
  end if;

  select
    count(*) filter (where position = 'GK'),
    count(*) filter (where position = 'DEF'),
    count(*) filter (where position = 'MID'),
    count(*) filter (where position = 'FWD')
  into v_gk, v_def, v_mid, v_fwd
  from public.players where id = any(p_starters);
  if v_gk <> 1 then raise exception 'Starting XI requires exactly one goalkeeper'; end if;
  if v_def < 3 then raise exception 'Starting XI requires at least three defenders'; end if;
  if v_mid < 2 then raise exception 'Starting XI requires at least two midfielders'; end if;
  if v_fwd < 1 then raise exception 'Starting XI requires at least one forward'; end if;
  if v_fwd > 4 then raise exception 'Starting XI allows at most four forwards'; end if;

  delete from public.lineup_players
  where league_id = p_league_id and user_id = v_user;
  insert into public.lineup_players (
    league_id, user_id, player_id, is_starter, is_captain, pitch_order
  ) select p_league_id, v_user, player_id, true, player_id = p_captain, ordinal
    from unnest(p_starters) with ordinality starter(player_id, ordinal);
  insert into public.lineup_players (
    league_id, user_id, player_id, is_starter, bench_order, is_captain
  ) select p_league_id, v_user, player_id, false, ordinal, false
    from unnest(p_bench) with ordinality bench(player_id, ordinal);
perform private.sync_exception_lineup(p_league_id,v_user);
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_pitch_order(p_league_id uuid, p_starters bigint[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid:=(select auth.uid());v_existing integer;v_matched integer;
begin
  perform private.validate_exception_lineup(p_league_id,v_user,p_starters,
 array(select player_id from public.lineup_players where league_id=p_league_id and user_id=v_user and not is_starter order by bench_order),
 (select player_id from public.lineup_players where league_id=p_league_id and user_id=v_user and is_captain));
  if v_user is null then raise exception 'Authentication required';end if;
  if not exists(select 1 from public.league_members where league_id=p_league_id and user_id=v_user) then raise exception 'League membership required';end if;
  if private.lineup_changes_locked(p_league_id) and private.lineup_exception_week(p_league_id) is null then raise exception 'Your full lineup is locked until every fixture in this gameweek is final';end if;
  if cardinality(p_starters)<>11 or cardinality(p_starters)<>cardinality(array(select distinct unnest(p_starters))) then raise exception 'Pitch order requires 11 unique starters';end if;
  select count(*) filter(where is_starter),count(*) filter(where is_starter and player_id=any(p_starters)) into v_existing,v_matched
  from public.lineup_players where league_id=p_league_id and user_id=v_user;
  if v_existing<>11 or v_matched<>11 then raise exception 'Pitch order must contain your saved starting eleven';end if;
  update public.lineup_players set pitch_order=null where league_id=p_league_id and user_id=v_user and is_starter;
  update public.lineup_players lp set pitch_order=s.ord
  from unnest(p_starters) with ordinality s(player_id,ord)
  where lp.league_id=p_league_id and lp.user_id=v_user and lp.player_id=s.player_id and lp.is_starter;
perform private.sync_exception_lineup(p_league_id,v_user);
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_lineup_captain(p_league_id uuid, p_captain bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := (select auth.uid());
begin
  perform private.validate_exception_lineup(p_league_id,v_user,
 array(select player_id from public.lineup_players where league_id=p_league_id and user_id=v_user and is_starter order by pitch_order),
 array(select player_id from public.lineup_players where league_id=p_league_id and user_id=v_user and not is_starter order by bench_order),p_captain);
  if v_user is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.league_members
    where league_id = p_league_id and user_id = v_user
  ) then raise exception 'League membership required'; end if;
  if private.lineup_changes_locked(p_league_id) and private.lineup_exception_week(p_league_id) is null then
    raise exception 'Your full lineup is locked until every fixture in this gameweek is final';
  end if;
  if not exists (
    select 1 from public.lineup_players lineup
    join public.players player on player.id = lineup.player_id
    where lineup.league_id = p_league_id
      and lineup.user_id = v_user
      and lineup.player_id = p_captain
      and lineup.is_starter
      and not player.injured
  ) then
    raise exception 'Your captain must be an available player in the starting eleven';
  end if;
  update public.lineup_players set is_captain = false
  where league_id = p_league_id and user_id = v_user and is_captain;
  update public.lineup_players set is_captain = true
  where league_id = p_league_id and user_id = v_user
    and player_id = p_captain and is_starter;
perform private.sync_exception_lineup(p_league_id,v_user);
end;
$function$;

