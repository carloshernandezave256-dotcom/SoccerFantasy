create or replace function public.refresh_league_matchup_scores(p_league_id uuid, p_gameweek smallint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_service_request boolean := coalesce((select auth.jwt() ->> 'role'), '') = 'service_role';
begin
  if not v_service_request and ((select auth.uid()) is null or not private.is_league_member(p_league_id)) then
    raise exception 'You are not a member of this league';
  end if;

  update public.league_matchups m
  set home_score = coalesce((
        select sum(private.player_score(
          p.position, s.minutes, s.goals, s.assists, s.shots_on_target,
          s.big_chances_missed, s.completed_passes, s.tackles_won,
          s.penalty_goals, s.penalties_missed, s.penalties_conceded,
          s.saves, s.penalties_saved, s.goals_conceded, s.yellow_cards,
          s.second_yellow_cards, s.red_cards, s.own_goals, s.man_of_the_match
        ) + case when lp.is_captain and s.man_of_the_match then 4 else 0 end)
        from public.lineup_players lp
        join public.players p on p.id = lp.player_id
        join public.league_player_scores s on s.league_id = lp.league_id and s.player_id = lp.player_id and s.gameweek = p_gameweek
        where lp.league_id = p_league_id and lp.user_id = m.home_user_id and lp.is_starter
      ), 0),
      away_score = coalesce((
        select sum(private.player_score(
          p.position, s.minutes, s.goals, s.assists, s.shots_on_target,
          s.big_chances_missed, s.completed_passes, s.tackles_won,
          s.penalty_goals, s.penalties_missed, s.penalties_conceded,
          s.saves, s.penalties_saved, s.goals_conceded, s.yellow_cards,
          s.second_yellow_cards, s.red_cards, s.own_goals, s.man_of_the_match
        ) + case when lp.is_captain and s.man_of_the_match then 4 else 0 end)
        from public.lineup_players lp
        join public.players p on p.id = lp.player_id
        join public.league_player_scores s on s.league_id = lp.league_id and s.player_id = lp.player_id and s.gameweek = p_gameweek
        where lp.league_id = p_league_id and lp.user_id = m.away_user_id and lp.is_starter
      ), 0),
      status = case
        when exists (select 1 from public.league_player_scores s where s.league_id = p_league_id and s.gameweek = p_gameweek and s.status = 'live') then 'live'
        when exists (select 1 from public.league_player_scores s where s.league_id = p_league_id and s.gameweek = p_gameweek)
          and not exists (select 1 from public.league_player_scores s where s.league_id = p_league_id and s.gameweek = p_gameweek and s.status <> 'final') then 'final'
        else 'scheduled'
      end
  where m.league_id = p_league_id and m.gameweek = p_gameweek;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.refresh_league_matchup_scores(uuid, smallint) from public, anon;
grant execute on function public.refresh_league_matchup_scores(uuid, smallint) to authenticated, service_role;
