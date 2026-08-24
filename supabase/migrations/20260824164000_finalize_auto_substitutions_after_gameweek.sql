begin;

-- Preserve the already-tested player pairing and lineup mutation routine, but
-- place a full-gameweek fixture gate in front of it. This makes substitutions
-- one settlement after the final real-world match, never a per-match action.
alter function private.apply_gameweek_auto_substitutions(uuid, smallint)
  rename to apply_gameweek_auto_substitution_settlement;

create or replace function private.gameweek_scoring_fixtures_final(
  p_league_id uuid,
  p_gameweek smallint
) returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  with league_config as (
    select league.calendar_competition, league.player_pool
    from public.leagues league
    where league.id = p_league_id
  ), calendar_window as (
    select min(fixture.kickoff) as first_kickoff,
           max(fixture.kickoff) as last_kickoff
    from public.league_headline_fixtures fixture
    join league_config config
      on config.calendar_competition = fixture.competition
    where fixture.league_id = p_league_id
      and fixture.gameweek = p_gameweek
  ), scoring_fixtures as (
    select fixture.status
    from public.league_headline_fixtures fixture
    cross join league_config config
    cross join calendar_window scoring_window
    where fixture.league_id = p_league_id
      and scoring_window.first_kickoff is not null
      and fixture.kickoff between scoring_window.first_kickoff and scoring_window.last_kickoff
      and (
        config.player_pool = 'All Top Five'
        or fixture.competition = config.player_pool
      )
  )
  select exists (select 1 from scoring_fixtures)
     and not exists (
       select 1
       from scoring_fixtures
       where lower(status) not in (
         'final', 'ft', 'aet', 'pen', 'pst', 'canc', 'abd', 'awd', 'wo'
       )
     );
$function$;

revoke all on function private.gameweek_scoring_fixtures_final(uuid, smallint)
from public, anon, authenticated;

create or replace function private.apply_gameweek_auto_substitutions(
  p_league_id uuid,
  p_gameweek smallint
) returns integer
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not private.gameweek_scoring_fixtures_final(p_league_id, p_gameweek) then
    return 0;
  end if;

  return private.apply_gameweek_auto_substitution_settlement(
    p_league_id,
    p_gameweek
  );
end;
$function$;

revoke all on function private.apply_gameweek_auto_substitutions(uuid, smallint)
from public, anon, authenticated;
revoke all on function private.apply_gameweek_auto_substitution_settlement(uuid, smallint)
from public, anon, authenticated;

-- Score rows can become final just before or just after the fixture cache does.
-- Keep both signals, with the wrapper guaranteeing that neither can settle the
-- week until all fixtures and all locked player score rows are final.
create or replace function private.apply_final_fixture_auto_substitutions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if lower(new.status) in (
    'final', 'ft', 'aet', 'pen', 'pst', 'canc', 'abd', 'awd', 'wo'
  ) then
    perform private.apply_gameweek_auto_substitutions(
      new.league_id,
      new.gameweek::smallint
    );
  end if;
  return new;
end;
$function$;

drop trigger if exists apply_final_fixture_auto_substitutions
on public.league_headline_fixtures;
create trigger apply_final_fixture_auto_substitutions
after insert or update of status
on public.league_headline_fixtures
for each row execute function private.apply_final_fixture_auto_substitutions();

revoke all on function private.apply_final_fixture_auto_substitutions()
from public, anon, authenticated;

commit;
