-- A fantasy league's selected calendar controls when its gameweek can score.
-- Raw score rows from another league/competition must never activate a week.
drop trigger if exists populate_new_league_cache on public.leagues;

-- Remove score rows written before the selected calendar competition began
-- that gameweek. These were copied by the retired cross-league score trigger.
delete from public.league_player_scores score
using public.leagues league
where league.id = score.league_id
  and score.source in ('api-football-live', 'api-football-shared-cache')
  and not exists (
    select 1
    from public.league_headline_fixtures fixture
    where fixture.league_id = score.league_id
      and fixture.competition = league.calendar_competition
      and fixture.gameweek = score.gameweek
      and fixture.kickoff <= coalesce(score.source_updated_at, score.updated_at)
  );

-- With the invalid rows gone, pre-kickoff matchups return to a clean scheduled
-- state and zero score. Live/final weeks retain their legitimate score rows.
update public.league_matchups matchup
set home_score = 0,
    away_score = 0,
    status = 'scheduled'
where not exists (
  select 1
  from public.league_player_scores score
  where score.league_id = matchup.league_id
    and score.gameweek = matchup.gameweek
);
