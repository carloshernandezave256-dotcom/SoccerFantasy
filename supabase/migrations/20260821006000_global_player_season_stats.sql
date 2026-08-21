create or replace function private.cached_match_fantasy_points(
  p_position text,
  p_minutes integer,
  p_goals integer,
  p_assists integer,
  p_shots_on_target integer,
  p_completed_passes integer,
  p_tackles_won integer,
  p_penalty_goals integer,
  p_penalties_missed integer,
  p_penalties_conceded integer,
  p_saves integer,
  p_penalties_saved integer,
  p_goals_conceded integer,
  p_yellow_cards integer,
  p_red_cards integer
) returns integer
language sql
immutable
set search_path = ''
as $$
  select
    case when coalesce(p_minutes, 0) >= 60 then 2 when coalesce(p_minutes, 0) > 0 then 1 else 0 end
    + coalesce(p_goals, 0) * case p_position when 'GK' then 7 when 'DEF' then 5 when 'MID' then 4 else 3 end
    + case when coalesce(p_goals, 0) >= 3 then case p_position when 'GK' then 9 when 'DEF' then 5 when 'MID' then 3 else 1 end else 0 end
    + coalesce(p_assists, 0) * 2
    + coalesce(p_shots_on_target, 0)
    + floor(coalesce(p_completed_passes, 0) / 10.0)::integer
    + floor(coalesce(p_tackles_won, 0) / 3.0)::integer
    + coalesce(p_penalty_goals, 0) * 2
    - coalesce(p_penalties_missed, 0) * 2
    - coalesce(p_penalties_conceded, 0) * 2
    + case when p_position = 'GK' then floor(coalesce(p_saves, 0) / 3.0)::integer + coalesce(p_penalties_saved, 0) * 2 else 0 end
    + case when p_position in ('GK', 'DEF') and coalesce(p_minutes, 0) >= 60 and coalesce(p_goals_conceded, 0) = 0 then 3 else 0 end
    + case when p_position in ('GK', 'DEF') and coalesce(p_minutes, 0) >= 60 and coalesce(p_goals_conceded, 0) >= 2 then -(coalesce(p_goals_conceded, 0) * 2 - 3) else 0 end
    - coalesce(p_yellow_cards, 0)
    - coalesce(p_red_cards, 0) * 3
$$;

create or replace function public.player_season_totals()
returns table(
  player_id bigint,
  points bigint,
  appearances bigint,
  minutes bigint,
  goals bigint,
  assists bigint,
  shots_on_target bigint,
  completed_passes bigint,
  tackles_won bigint,
  saves bigint,
  clean_sheets bigint,
  yellow_cards bigint,
  red_cards bigint,
  motm bigint,
  latest_gameweek integer,
  latest_status text
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
    select case when extract(month from now()) <= 6 then extract(year from now())::integer - 1 else extract(year from now())::integer end as season
  ), matches as (
    select s.player_id, f.gameweek, f.status, f.kickoff, s.minutes, s.goals, s.assists,
      s.shots_on_target, s.completed_passes, s.tackles_won, s.saves, s.goals_conceded,
      s.yellow_cards, s.red_cards, s.man_of_the_match,
      private.cached_match_fantasy_points(p.position::text, s.minutes, s.goals, s.assists,
        s.shots_on_target, s.completed_passes, s.tackles_won, s.penalty_goals,
        s.penalties_missed, s.penalties_conceded, s.saves, s.penalties_saved,
        s.goals_conceded, s.yellow_cards, s.red_cards) as points
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
    coalesce(sum(m.assists), 0)::bigint, coalesce(sum(m.shots_on_target), 0)::bigint,
    coalesce(sum(m.completed_passes), 0)::bigint, coalesce(sum(m.tackles_won), 0)::bigint,
    coalesce(sum(m.saves), 0)::bigint,
    count(*) filter (where m.minutes >= 60 and m.goals_conceded = 0 and p.position::text in ('GK','DEF'))::bigint,
    coalesce(sum(m.yellow_cards), 0)::bigint, coalesce(sum(m.red_cards), 0)::bigint,
    count(*) filter (where m.man_of_the_match)::bigint,
    l.gameweek, l.status
  from public.players p
  left join matches m on m.player_id = p.id
  left join latest l on l.player_id = p.id
  where p.active
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
  select f.fixture_id, f.gameweek, f.kickoff, f.status, f.home_team, f.away_team,
    f.home_score, f.away_score, s.rating, s.minutes, s.goals, s.assists,
    s.shots_on_target, s.completed_passes, s.tackles_won, s.saves,
    s.goals_conceded, s.yellow_cards, s.red_cards, s.man_of_the_match,
    private.cached_match_fantasy_points(p.position::text, s.minutes, s.goals, s.assists,
      s.shots_on_target, s.completed_passes, s.tackles_won, s.penalty_goals,
      s.penalties_missed, s.penalties_conceded, s.saves, s.penalties_saved,
      s.goals_conceded, s.yellow_cards, s.red_cards)
  from public.football_fixture_player_stats s
  join public.football_fixture_cache f on f.fixture_id = s.fixture_id
  join public.players p on p.id = s.player_id
  where s.player_id = p_player_id
    and f.season = case when extract(month from now()) <= 6 then extract(year from now())::integer - 1 else extract(year from now())::integer end
  order by f.kickoff desc;
end
$$;

revoke all on function public.player_season_totals() from public, anon;
revoke all on function public.player_season_history(bigint) from public, anon;
grant execute on function public.player_season_totals() to authenticated;
grant execute on function public.player_season_history(bigint) to authenticated;
