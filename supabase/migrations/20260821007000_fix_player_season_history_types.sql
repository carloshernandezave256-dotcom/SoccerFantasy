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
    f.home_score, f.away_score, s.rating,
    s.minutes::integer, s.goals::integer, s.assists::integer,
    s.shots_on_target::integer, s.completed_passes::integer,
    s.tackles_won::integer, s.saves::integer, s.goals_conceded::integer,
    s.yellow_cards::integer, s.red_cards::integer, s.man_of_the_match,
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

revoke all on function public.player_season_history(bigint) from public, anon;
grant execute on function public.player_season_history(bigint) to authenticated;
