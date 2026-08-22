create or replace function private.manager_gameweek_score(p_league_id uuid,p_user_id uuid,p_gameweek smallint)
returns numeric language sql stable set search_path='' as $$
  select coalesce(sum(
    case when l.is_star_pick then floor(coalesce(s.fantasy_points,0)*1.5)
         else coalesce(s.fantasy_points,0) end
  ),0)
  from public.lineup_gameweek_players l
  left join public.league_player_scores s
    on s.league_id=l.league_id and s.player_id=l.player_id and s.gameweek=l.gameweek
  where l.league_id=p_league_id and l.gameweek=p_gameweek
    and l.user_id=p_user_id and l.is_starter;
$$;

update public.league_matchups m
set home_score=private.manager_gameweek_score(m.league_id,m.home_user_id,m.gameweek),
    away_score=private.manager_gameweek_score(m.league_id,m.away_user_id,m.gameweek)
where exists(select 1 from public.league_player_scores s
  where s.league_id=m.league_id and s.gameweek=m.gameweek);
