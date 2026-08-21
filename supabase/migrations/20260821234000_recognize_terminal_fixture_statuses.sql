-- API-Football stores completed shared fixtures as FT/AET/PEN, while
-- league_player_scores uses final. Treat both formats as completed so every
-- surface awards the same clean-sheet points.
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
        case when lower(f.status) in ('final','ft','aet','pen')
          then s.goals_conceded else -1 end,
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
    count(*) filter (
      where lower(m.status) in ('final','ft','aet','pen')
        and m.minutes > 0 and m.goals_conceded = 0
    )::bigint,
    coalesce(sum(m.yellow_cards), 0)::bigint,
    coalesce(sum(m.red_cards), 0)::bigint,
    count(*) filter (where m.man_of_the_match)::bigint,
    l.gameweek, l.status
  from public.players p
  left join matches m on m.player_id = p.id
  left join latest l on l.player_id = p.id
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
      case when lower(f.status) in ('final','ft','aet','pen')
        then s.goals_conceded else -1 end,
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
