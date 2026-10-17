-- A delayed settlement must open the next scheduled round even after kickoff.
-- New leagues still begin at a future kickoff; existing leagues never skip a round.
CREATE OR REPLACE FUNCTION private.refresh_league_calendar(p_league_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_league public.leagues%rowtype;
  v_current public.league_transaction_windows%rowtype;
  v_gameweek integer;
  v_first_kickoff timestamptz;
  v_roster_lock timestamptz;
  v_waiver_process timestamptz;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_league_id::text,0));
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

    -- Use the same complete fantasy fixture set as scoring, not only its calendar competition.
    if not exists(select 1 from public.finalized_gameweek_locks where league_id=p_league_id and gameweek=v_current.gameweek)
      or not exists(select 1 from public.lineup_gameweek_players
        where league_id=p_league_id and gameweek=v_current.gameweek)
    then
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
  having v_current.id is not null or min(fixture.kickoff) > now()
  order by min(fixture.kickoff)
  limit 1;

  if v_gameweek is null then return null; end if;

  v_roster_lock := v_first_kickoff - make_interval(mins => v_league.lineup_lock_minutes);
  v_waiver_process := (
    date_trunc('week', v_first_kickoff at time zone 'America/Los_Angeles')::date
    + 3 + time '00:00'
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
$function$

