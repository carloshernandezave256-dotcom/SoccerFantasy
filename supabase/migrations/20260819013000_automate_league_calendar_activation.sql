-- Reuse cached real-world calendars and activate the first fair fantasy gameweek.
create index if not exists league_headline_fixtures_competition_idx
  on public.league_headline_fixtures (competition, kickoff, updated_at desc);

create or replace function private.copy_cached_league_fixtures(p_league_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_pool text;
  v_count integer := 0;
begin
  select player_pool into v_pool
  from public.leagues
  where id = p_league_id;

  if v_pool is null then return 0; end if;

  insert into public.league_headline_fixtures (
    league_id, fixture_id, gameweek, competition, round_name, kickoff,
    status, home_team, away_team, home_score, away_score, updated_at
  )
  select
    p_league_id, cached.fixture_id, cached.gameweek, cached.competition,
    cached.round_name, cached.kickoff, cached.status, cached.home_team,
    cached.away_team, cached.home_score, cached.away_score, cached.updated_at
  from (
    select distinct on (fixture.fixture_id)
      fixture.fixture_id, fixture.gameweek, fixture.competition,
      fixture.round_name, fixture.kickoff, fixture.status,
      fixture.home_team, fixture.away_team, fixture.home_score,
      fixture.away_score, fixture.updated_at
    from public.league_headline_fixtures fixture
    where fixture.league_id <> p_league_id
      and (v_pool = 'All Top Five' or fixture.competition = v_pool)
    order by fixture.fixture_id, fixture.updated_at desc
  ) cached
  on conflict (league_id, fixture_id) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end
$$;

create or replace function private.refresh_league_calendar(p_league_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_league public.leagues%rowtype;
  v_current public.league_transaction_windows%rowtype;
  v_gameweek integer;
  v_first_kickoff timestamptz;
  v_roster_lock timestamptz;
  v_waiver_process timestamptz;
begin
  select * into v_league
  from public.leagues
  where id = p_league_id;

  if not found then return null; end if;

  -- Exclusive-player leagues begin only after team acquisition is complete.
  if v_league.game_format in ('draft', 'auction')
    and not exists (
      select 1 from public.drafts
      where league_id = p_league_id and status = 'complete'
    )
  then
    return null;
  end if;

  -- Pack leagues need an opponent before their first scoring week begins.
  if v_league.game_format = 'pack'
    and (select count(*) from public.league_members where league_id = p_league_id) < 2
  then
    return null;
  end if;

  select * into v_current
  from public.league_transaction_windows
  where league_id = p_league_id
  order by gameweek desc
  limit 1;

  if found then
    if v_current.roster_lock_at > now() then
      return v_current.gameweek;
    end if;

    -- Do not roll forward until every cached fixture in the active gameweek is final.
    if not exists (
      select 1 from public.league_headline_fixtures
      where league_id = p_league_id
        and competition = v_league.calendar_competition
        and gameweek = v_current.gameweek
    ) or exists (
      select 1 from public.league_headline_fixtures
      where league_id = p_league_id
        and competition = v_league.calendar_competition
        and gameweek = v_current.gameweek
        and status not in ('FT', 'AET', 'PEN', 'PST', 'CANC', 'ABD', 'AWD', 'WO')
    ) then
      return v_current.gameweek;
    end if;
  end if;

  select fixture.gameweek, min(fixture.kickoff)
  into v_gameweek, v_first_kickoff
  from public.league_headline_fixtures fixture
  where fixture.league_id = p_league_id
    and fixture.competition = v_league.calendar_competition
    and (v_current.id is null or fixture.gameweek > v_current.gameweek)
  group by fixture.gameweek
  having min(fixture.kickoff) > now()
  order by min(fixture.kickoff)
  limit 1;

  if v_gameweek is null then return null; end if;

  v_roster_lock := v_first_kickoff - make_interval(mins => v_league.lineup_lock_minutes);
  v_waiver_process := (
    date_trunc('week', v_first_kickoff at time zone 'America/Los_Angeles')::date
    + 3 + time '08:00'
  ) at time zone 'America/Los_Angeles';

  if v_waiver_process >= v_roster_lock then
    v_waiver_process := v_roster_lock - interval '1 second';
  end if;

  insert into public.league_transaction_windows (
    league_id, gameweek, waiver_process_at, roster_lock_at
  ) values (
    p_league_id, v_gameweek, v_waiver_process, v_roster_lock
  )
  on conflict (league_id, gameweek) do update
  set waiver_process_at = excluded.waiver_process_at,
      roster_lock_at = excluded.roster_lock_at,
      updated_at = now()
  where public.league_transaction_windows.processed_at is null;

  return v_gameweek;
end
$$;

create or replace function public.refresh_league_calendar(p_league_id uuid)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select private.refresh_league_calendar(p_league_id)
$$;

-- New leagues immediately inherit any calendar data already cached for the same pool.
create or replace function public.create_league(
  p_name text,p_team_name text,p_size smallint,p_draft_pick_seconds smallint,p_trades_enabled boolean,
  p_lineup_lock_minutes smallint,p_game_format text,p_calendar_competition text,p_player_pool text,
  p_auction_style text default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_id uuid;v_code text;v_calendar text;
begin
  if v_user is null then raise exception 'Authentication required';end if;
  if p_size not in(8,10,12) then raise exception 'League size must be 8, 10, or 12';end if;
  if p_draft_pick_seconds not in(30,60,90,120) then raise exception 'Choose a valid draft clock';end if;
  if p_lineup_lock_minutes not in(0,15,30,60) then raise exception 'Choose a valid lineup lock time';end if;
  if p_game_format not in('draft','pack','auction') then raise exception 'Choose Draft, Pack, or Auction League';end if;
  if p_game_format='auction' and p_auction_style not in('nomination','mystery') then raise exception 'Choose an Auction Style';end if;
  if p_player_pool not in('All Top Five','Premier League','La Liga','Serie A','Bundesliga','Ligue 1') then raise exception 'Choose a supported player pool';end if;
  v_calendar:=case when p_player_pool='All Top Five' then p_calendar_competition else p_player_pool end;
  if v_calendar not in('Premier League','La Liga','Serie A','Bundesliga','Ligue 1') then raise exception 'Choose a supported Fantasy Calendar';end if;
  v_code:='XI-'||upper(substr(md5(gen_random_uuid()::text),1,6));
  insert into public.leagues(name,invite_code,size,commissioner_id,draft_pick_seconds,trades_enabled,lineup_lock_minutes,game_format,calendar_competition,player_pool,auction_style)
  values(trim(p_name),v_code,p_size,v_user,p_draft_pick_seconds,p_trades_enabled,p_lineup_lock_minutes,p_game_format,v_calendar,p_player_pool,case when p_game_format='auction' then p_auction_style else null end) returning id into v_id;
  insert into public.league_members(league_id,user_id,team_name,role,draft_slot,waiver_priority)
  values(v_id,v_user,trim(p_team_name),'commissioner',1,1);
  if p_game_format='pack' then insert into public.pack_wallets(league_id,user_id) values(v_id,v_user);end if;
  perform private.copy_cached_league_fixtures(v_id);
  return v_id;
end$$;

-- Schedules start at the first unstarted official gameweek, not always gameweek one.
create or replace function private.ensure_draft_schedule(p_league_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_users uuid[];
  v_slots integer;
  v_rounds integer;
  v_round integer;
  v_pair integer;
  v_first uuid;
  v_second uuid;
  v_start_gameweek integer;
  v_last_gameweek integer;
  v_calendar text;
  v_home_gameweek integer;
  v_away_gameweek integer;
begin
  if exists(select 1 from public.league_matchups where league_id=p_league_id) then return; end if;

  select calendar_competition into v_calendar from public.leagues where id=p_league_id;
  select gameweek into v_start_gameweek
  from public.league_transaction_windows
  where league_id=p_league_id and roster_lock_at>now()
  order by roster_lock_at limit 1;

  if v_start_gameweek is null then
    select fixture.gameweek into v_start_gameweek
    from public.league_headline_fixtures fixture
    where fixture.league_id=p_league_id and fixture.competition=v_calendar
    group by fixture.gameweek
    having min(fixture.kickoff)>now()
    order by min(fixture.kickoff) limit 1;
  end if;

  v_start_gameweek:=coalesce(v_start_gameweek,1);
  select coalesce(max(gameweek),50) into v_last_gameweek
  from public.league_headline_fixtures
  where league_id=p_league_id and competition=v_calendar;

  select array_agg(user_id order by draft_slot,joined_at) into v_users
  from public.league_members where league_id=p_league_id;
  if coalesce(cardinality(v_users),0)<2 then return; end if;
  if mod(cardinality(v_users),2)=1 then v_users:=array_append(v_users,null::uuid); end if;
  v_slots:=cardinality(v_users);v_rounds:=v_slots-1;

  for v_round in 1..v_rounds loop
    v_home_gameweek:=v_start_gameweek+v_round-1;
    v_away_gameweek:=v_home_gameweek+v_rounds;
    for v_pair in 1..(v_slots/2) loop
      v_first:=v_users[v_pair];v_second:=v_users[v_slots-v_pair+1];
      if v_first is not null and v_second is not null then
        if mod(v_round+v_pair,2)=0 then
          if v_home_gameweek<=v_last_gameweek then insert into public.league_matchups(league_id,gameweek,home_user_id,away_user_id) values(p_league_id,v_home_gameweek,v_first,v_second);end if;
          if v_away_gameweek<=v_last_gameweek then insert into public.league_matchups(league_id,gameweek,home_user_id,away_user_id) values(p_league_id,v_away_gameweek,v_second,v_first);end if;
        else
          if v_home_gameweek<=v_last_gameweek then insert into public.league_matchups(league_id,gameweek,home_user_id,away_user_id) values(p_league_id,v_home_gameweek,v_second,v_first);end if;
          if v_away_gameweek<=v_last_gameweek then insert into public.league_matchups(league_id,gameweek,home_user_id,away_user_id) values(p_league_id,v_away_gameweek,v_first,v_second);end if;
        end if;
      end if;
    end loop;
    v_users:=array[v_users[1],v_users[v_slots]]||v_users[2:v_slots-1];
  end loop;
end
$$;

create or replace function public.ensure_league_schedule(p_league_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not exists (
    select 1 from public.league_members
    where league_id=p_league_id and user_id=(select auth.uid())
  ) then
    raise exception 'League membership required';
  end if;
  perform private.ensure_draft_schedule(p_league_id);
  return (select count(*)::integer from public.league_matchups where league_id=p_league_id);
end
$$;

-- Existing leagues also reuse the freshest cached schedule immediately.
do $$
declare league_row record;
begin
  for league_row in select id from public.leagues loop
    perform private.copy_cached_league_fixtures(league_row.id);
    perform private.refresh_league_calendar(league_row.id);
  end loop;
end
$$;

revoke all on function private.copy_cached_league_fixtures(uuid), private.refresh_league_calendar(uuid), private.ensure_draft_schedule(uuid) from public, anon, authenticated;
revoke all on function public.refresh_league_calendar(uuid) from public, anon, authenticated;
grant execute on function public.refresh_league_calendar(uuid) to service_role;
revoke all on function public.create_league(text,text,smallint,smallint,boolean,smallint,text,text,text,text) from public,anon;
grant execute on function public.create_league(text,text,smallint,smallint,boolean,smallint,text,text,text,text) to authenticated;
revoke all on function public.ensure_league_schedule(uuid) from public,anon;
grant execute on function public.ensure_league_schedule(uuid) to authenticated;
