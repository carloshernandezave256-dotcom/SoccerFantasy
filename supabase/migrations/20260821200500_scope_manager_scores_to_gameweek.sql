-- A manager can have immutable lineup snapshots for multiple rounds. Score only
-- the requested snapshot so live matchup totals exactly match its player ledger.
create or replace function private.manager_gameweek_score(
  p_league_id uuid,
  p_user_id uuid,
  p_gameweek smallint
) returns numeric
language sql stable
set search_path = ''
as $$
  with starter_scores as (
    select
      lineup.is_star_pick,
      coalesce(private.player_score(
        player.position, score.minutes, score.goals, score.assists,
        score.shots_on_target, score.big_chances_missed,
        score.completed_passes, score.tackles_won, score.penalty_goals,
        score.penalties_missed, score.penalties_conceded, score.saves,
        score.penalties_saved, score.goals_conceded, score.yellow_cards,
        score.second_yellow_cards, score.red_cards, score.own_goals,
        score.man_of_the_match
      ), 0) as base_score
    from public.lineup_gameweek_players lineup
    join public.players player on player.id = lineup.player_id
    left join public.league_player_scores score
      on score.league_id = lineup.league_id
      and score.player_id = lineup.player_id
      and score.gameweek = p_gameweek
    where lineup.league_id = p_league_id
      and lineup.gameweek = p_gameweek
      and lineup.user_id = p_user_id
      and lineup.is_starter
  )
  select coalesce(sum(
    base_score + case when is_star_pick then base_score * 0.5 else 0 end
  ), 0)
  from starter_scores;
$$;

revoke all on function private.manager_gameweek_score(uuid, uuid, smallint)
  from public, anon, authenticated;

-- Correct already-materialized live/final totals without changing schedules.
do $$
declare
  active_round record;
begin
  for active_round in
    select distinct matchup.league_id, matchup.gameweek
    from public.league_matchups matchup
    where matchup.status in ('live', 'final')
  loop
    update public.league_matchups matchup
    set home_score = private.manager_gameweek_score(
          active_round.league_id, matchup.home_user_id, active_round.gameweek
        ),
        away_score = private.manager_gameweek_score(
          active_round.league_id, matchup.away_user_id, active_round.gameweek
        )
    where matchup.league_id = active_round.league_id
      and matchup.gameweek = active_round.gameweek;
  end loop;
end;
$$;
