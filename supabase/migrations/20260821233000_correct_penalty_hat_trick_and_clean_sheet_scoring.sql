-- Align every database-backed calculator with the published scoring ledger.
-- Penalty goals are 2 FP regardless of position but count toward hat-tricks.
-- Clean sheets require any appearance: GK/DEF +3, MID +1, FWD +0.
create or replace function private.player_score(
  p_position public.player_position, p_minutes integer, p_goals integer,
  p_assists integer, p_shots_on_target integer, p_big_chances_missed integer,
  p_completed_passes integer, p_tackles_won integer, p_penalty_goals integer,
  p_penalties_missed integer, p_penalties_conceded integer, p_saves integer,
  p_penalties_saved integer, p_goals_conceded integer, p_yellow_cards integer,
  p_second_yellow_cards integer, p_red_cards integer, p_own_goals integer,
  p_man_of_the_match boolean
) returns numeric
language sql immutable
set search_path = ''
as $$
  select
    case when p_minutes >= 60 then 2 when p_minutes > 0 then 1 else 0 end
    + greatest(coalesce(p_goals, 0) - coalesce(p_penalty_goals, 0), 0)
      * case p_position when 'GK' then 7 when 'DEF' then 5 when 'MID' then 4 else 3 end
    + case when coalesce(p_goals, 0) >= 3
        then case p_position when 'GK' then 9 when 'DEF' then 5 when 'MID' then 3 else 1 end
          + least(coalesce(p_penalty_goals, 0), coalesce(p_goals, 0), 3)
            * (case p_position when 'GK' then 7 when 'DEF' then 5 when 'MID' then 4 else 3 end - 2)
        else 0 end
    + coalesce(p_assists, 0) * 2
    + floor(coalesce(p_shots_on_target, 0) / 3.0)
    + floor(coalesce(p_completed_passes, 0) / 10.0)
    + floor(coalesce(p_tackles_won, 0) / 3.0)
    + least(coalesce(p_penalty_goals, 0), coalesce(p_goals, 0)) * 2
    - coalesce(p_penalties_missed, 0) * 2
    - coalesce(p_penalties_conceded, 0) * 2
    + case when p_position = 'GK' then floor(coalesce(p_saves, 0) / 3.0) + coalesce(p_penalties_saved, 0) * 2 else 0 end
    + case when p_minutes > 0 and coalesce(p_goals_conceded, 0) = 0
        then case p_position when 'GK' then 3 when 'DEF' then 3 when 'MID' then 1 else 0 end
        else 0 end
    + case when p_position in ('GK','DEF') and p_minutes >= 60 and coalesce(p_goals_conceded, 0) >= 2
        then -(coalesce(p_goals_conceded, 0) * 2 - 3) else 0 end
    - coalesce(p_yellow_cards, 0)
    - coalesce(p_second_yellow_cards, 0) * 2
    - coalesce(p_red_cards, 0) * 3
    - coalesce(p_own_goals, 0) * 3;
$$;

create or replace function private.cached_match_fantasy_points(
  p_position text, p_minutes integer, p_goals integer, p_assists integer,
  p_shots_on_target integer, p_completed_passes integer, p_tackles_won integer,
  p_penalty_goals integer, p_penalties_missed integer, p_penalties_conceded integer,
  p_saves integer, p_penalties_saved integer, p_goals_conceded integer,
  p_yellow_cards integer, p_red_cards integer
) returns integer
language sql immutable
set search_path = ''
as $$
  select (
    case when coalesce(p_minutes, 0) >= 60 then 2 when coalesce(p_minutes, 0) > 0 then 1 else 0 end
    + greatest(coalesce(p_goals, 0) - coalesce(p_penalty_goals, 0), 0)
      * case p_position when 'GK' then 7 when 'DEF' then 5 when 'MID' then 4 else 3 end
    + case when coalesce(p_goals, 0) >= 3
        then case p_position when 'GK' then 9 when 'DEF' then 5 when 'MID' then 3 else 1 end
          + least(coalesce(p_penalty_goals, 0), coalesce(p_goals, 0), 3)
            * (case p_position when 'GK' then 7 when 'DEF' then 5 when 'MID' then 4 else 3 end - 2)
        else 0 end
    + coalesce(p_assists, 0) * 2
    + floor(coalesce(p_shots_on_target, 0) / 3.0)::integer
    + floor(coalesce(p_completed_passes, 0) / 10.0)::integer
    + floor(coalesce(p_tackles_won, 0) / 3.0)::integer
    + least(coalesce(p_penalty_goals, 0), coalesce(p_goals, 0)) * 2
    - coalesce(p_penalties_missed, 0) * 2
    - coalesce(p_penalties_conceded, 0) * 2
    + case when p_position = 'GK' then floor(coalesce(p_saves, 0) / 3.0)::integer + coalesce(p_penalties_saved, 0) * 2 else 0 end
    + case when coalesce(p_minutes, 0) > 0 and coalesce(p_goals_conceded, 0) = 0
        then case p_position when 'GK' then 3 when 'DEF' then 3 when 'MID' then 1 else 0 end
        else 0 end
    + case when p_position in ('GK','DEF') and coalesce(p_minutes, 0) >= 60 and coalesce(p_goals_conceded, 0) >= 2
        then -(coalesce(p_goals_conceded, 0) * 2 - 3) else 0 end
    - coalesce(p_yellow_cards, 0)
    - coalesce(p_red_cards, 0) * 3
  )::integer;
$$;

-- A live 0-0 is not a clean sheet yet. Pass a sentinel conceded value to the
-- calculator until the saved player score has reached final status.
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
        score.penalties_saved,
        case when score.status = 'final' then score.goals_conceded else -1 end,
        score.yellow_cards, score.second_yellow_cards, score.red_cards,
        score.own_goals, score.man_of_the_match
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

create or replace function public.player_season_totals()
returns table(
  player_id bigint, points bigint, appearances bigint, minutes bigint,
  goals bigint, assists bigint, shots_on_target bigint,
  completed_passes bigint, tackles_won bigint, saves bigint,
  clean_sheets bigint, yellow_cards bigint, red_cards bigint, motm bigint,
  latest_gameweek integer, latest_status text
)
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  return query
  with current_season as (
    select case when extract(month from now()) <= 6
      then extract(year from now())::integer - 1
      else extract(year from now())::integer end as season
  ), matches as (
    select s.player_id, f.gameweek, f.status, f.kickoff, s.minutes, s.goals,
      s.assists, s.shots_on_target, s.completed_passes, s.tackles_won,
      s.saves, s.goals_conceded, s.yellow_cards, s.red_cards,
      s.man_of_the_match,
      private.cached_match_fantasy_points(
        p.position::text, s.minutes, s.goals, s.assists, s.shots_on_target,
        s.completed_passes, s.tackles_won, s.penalty_goals,
        s.penalties_missed, s.penalties_conceded, s.saves,
        s.penalties_saved,
        case when f.status = 'final' then s.goals_conceded else -1 end,
        s.yellow_cards, s.red_cards
      ) as points
    from public.football_fixture_player_stats s
    join public.football_fixture_cache f on f.fixture_id = s.fixture_id
    join public.players p on p.id = s.player_id
    join current_season cs on cs.season = f.season
  ), latest as (
    select distinct on (m.player_id) m.player_id, m.gameweek, m.status
    from matches m order by m.player_id, m.kickoff desc
  )
  select p.id, coalesce(sum(m.points), 0)::bigint,
    count(*) filter (where m.minutes > 0)::bigint,
    coalesce(sum(m.minutes), 0)::bigint, coalesce(sum(m.goals), 0)::bigint,
    coalesce(sum(m.assists), 0)::bigint,
    coalesce(sum(m.shots_on_target), 0)::bigint,
    coalesce(sum(m.completed_passes), 0)::bigint,
    coalesce(sum(m.tackles_won), 0)::bigint,
    coalesce(sum(m.saves), 0)::bigint,
    count(*) filter (where m.status = 'final' and m.minutes > 0 and m.goals_conceded = 0)::bigint,
    coalesce(sum(m.yellow_cards), 0)::bigint,
    coalesce(sum(m.red_cards), 0)::bigint,
    count(*) filter (where m.man_of_the_match)::bigint,
    l.gameweek, l.status
  from public.players p
  left join matches m on m.player_id = p.id
  left join latest l on l.player_id = p.id
  -- Do not emit thousands of zero rows. PostgREST caps function responses, so
  -- returning every active player hid later player IDs (including Marseille)
  -- from Fantasy Pulse and the Player Market. Both clients already default a
  -- missing player to zero until that player records a match.
  where p.active and m.player_id is not null
  group by p.id, l.gameweek, l.status;
end
$$;

create or replace function public.player_season_history(p_player_id bigint)
returns table(
  fixture_id bigint, gameweek integer, kickoff timestamptz, status text,
  home_team text, away_team text, home_score integer, away_score integer,
  rating numeric, minutes integer, goals integer, assists integer,
  shots_on_target integer, completed_passes integer, tackles_won integer,
  saves integer, goals_conceded integer, yellow_cards integer, red_cards integer,
  man_of_the_match boolean, points integer
)
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  return query
  select f.fixture_id, f.gameweek, f.kickoff, f.status, f.home_team,
    f.away_team, f.home_score, f.away_score, s.rating,
    s.minutes::integer, s.goals::integer, s.assists::integer,
    s.shots_on_target::integer, s.completed_passes::integer,
    s.tackles_won::integer, s.saves::integer, s.goals_conceded::integer,
    s.yellow_cards::integer, s.red_cards::integer, s.man_of_the_match,
    private.cached_match_fantasy_points(
      p.position::text, s.minutes, s.goals, s.assists, s.shots_on_target,
      s.completed_passes, s.tackles_won, s.penalty_goals,
      s.penalties_missed, s.penalties_conceded, s.saves,
      s.penalties_saved,
      case when f.status = 'final' then s.goals_conceded else -1 end,
      s.yellow_cards, s.red_cards
    )
  from public.football_fixture_player_stats s
  join public.football_fixture_cache f on f.fixture_id = s.fixture_id
  join public.players p on p.id = s.player_id
  where s.player_id = p_player_id
    and f.season = case when extract(month from now()) <= 6
      then extract(year from now())::integer - 1
      else extract(year from now())::integer end
  order by f.kickoff desc;
end
$$;

revoke all on function public.player_season_totals() from public, anon;
revoke all on function public.player_season_history(bigint) from public, anon;
grant execute on function public.player_season_totals() to authenticated;
grant execute on function public.player_season_history(bigint) to authenticated;

-- Refresh already materialized live/final matchup totals immediately.
do $$
declare active_round record;
begin
  for active_round in
    select distinct league_id, gameweek from public.league_matchups
    where status in ('live', 'final')
  loop
    update public.league_matchups matchup
    set home_score = private.manager_gameweek_score(active_round.league_id, matchup.home_user_id, active_round.gameweek),
        away_score = private.manager_gameweek_score(active_round.league_id, matchup.away_user_id, active_round.gameweek)
    where matchup.league_id = active_round.league_id
      and matchup.gameweek = active_round.gameweek;
  end loop;
end;
$$;
