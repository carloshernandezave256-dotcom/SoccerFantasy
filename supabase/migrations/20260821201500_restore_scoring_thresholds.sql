-- Keep the database calculator aligned with the published league scoring table:
-- one fantasy point per complete group of three shots on target, and minus one
-- for each yellow card.
create or replace function private.player_score(
  p_position public.player_position,
  p_minutes integer,
  p_goals integer,
  p_assists integer,
  p_shots_on_target integer,
  p_big_chances_missed integer,
  p_completed_passes integer,
  p_tackles_won integer,
  p_penalty_goals integer,
  p_penalties_missed integer,
  p_penalties_conceded integer,
  p_saves integer,
  p_penalties_saved integer,
  p_goals_conceded integer,
  p_yellow_cards integer,
  p_second_yellow_cards integer,
  p_red_cards integer,
  p_own_goals integer,
  p_man_of_the_match boolean
) returns numeric
language sql immutable
set search_path = ''
as $$
  select
    case when p_minutes >= 60 then 2 when p_minutes > 0 then 1 else 0 end
    + p_goals * case p_position when 'GK' then 7 when 'DEF' then 5 when 'MID' then 4 else 3 end
    + case when p_goals >= 3 then case p_position when 'GK' then 9 when 'DEF' then 5 when 'MID' then 3 else 1 end else 0 end
    + p_assists * 2
    + floor(p_shots_on_target / 3.0)
    + floor(p_completed_passes / 10.0)
    + floor(p_tackles_won / 3.0)
    + p_penalty_goals * 2
    - p_penalties_missed * 2
    - p_penalties_conceded * 2
    + case when p_position = 'GK' then floor(p_saves / 3.0) + p_penalties_saved * 2 else 0 end
    + case when p_position in ('GK','DEF') and p_minutes >= 60 and p_goals_conceded = 0 then 3 else 0 end
    + case when p_position in ('GK','DEF') and p_minutes >= 60 and p_goals_conceded >= 2 then -(p_goals_conceded * 2 - 3) else 0 end
    - p_yellow_cards
    - p_second_yellow_cards * 2
    - p_red_cards * 3
    - p_own_goals * 3;
$$;

revoke all on function private.player_score(
  public.player_position, integer, integer, integer, integer, integer,
  integer, integer, integer, integer, integer, integer, integer, integer,
  integer, integer, integer, integer, boolean
) from public, anon, authenticated;

-- Recalculate materialized matchup totals immediately. This leaves schedules,
-- lineups, and the incoming provider statistics unchanged.
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
