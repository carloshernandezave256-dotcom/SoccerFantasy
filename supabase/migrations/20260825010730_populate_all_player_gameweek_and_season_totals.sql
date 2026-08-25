begin;

-- Season totals are a complete player-pool dataset. Players without a stored
-- appearance remain visible with legitimate zero totals until data arrives.
create or replace function public.player_season_totals()
returns table(
  player_id bigint, points bigint, appearances bigint, minutes bigint,
  goals bigint, assists bigint, shots_on_target bigint,
  completed_passes bigint, tackles_won bigint, saves bigint,
  clean_sheets bigint, yellow_cards bigint, red_cards bigint, motm bigint,
  latest_gameweek integer, latest_status text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  return query
  with current_season as (
    select case
      when extract(month from now()) <= 6
        then extract(year from now())::integer - 1
      else extract(year from now())::integer
    end season
  ), matches as (
    select stat.*, fixture.gameweek, fixture.status, fixture.kickoff
    from public.football_fixture_player_stats stat
    join public.football_fixture_cache fixture using (fixture_id)
    join current_season on current_season.season = fixture.season
  ), latest as (
    select distinct on (player_match.player_id)
      player_match.player_id, player_match.gameweek, player_match.status
    from matches player_match
    order by player_match.player_id, player_match.kickoff desc
  )
  select
    player.id,
    coalesce(sum(player_match.fantasy_points), 0)::bigint,
    count(*) filter (where player_match.minutes > 0)::bigint,
    coalesce(sum(player_match.minutes), 0)::bigint,
    coalesce(sum(player_match.goals), 0)::bigint,
    coalesce(sum(player_match.assists), 0)::bigint,
    coalesce(sum(player_match.shots_on_target), 0)::bigint,
    coalesce(sum(player_match.completed_passes), 0)::bigint,
    coalesce(sum(player_match.tackles_won), 0)::bigint,
    coalesce(sum(player_match.saves), 0)::bigint,
    count(*) filter (
      where lower(player_match.status) in ('final', 'ft', 'aet', 'pen')
        and player_match.minutes > 0
        and player_match.goals_conceded = 0
    )::bigint,
    coalesce(sum(player_match.yellow_cards), 0)::bigint,
    coalesce(sum(player_match.red_cards), 0)::bigint,
    count(*) filter (where player_match.man_of_the_match)::bigint,
    latest.gameweek,
    latest.status
  from public.players player
  left join matches player_match on player_match.player_id = player.id
  left join latest on latest.player_id = player.id
  where player.active
  group by player.id, latest.gameweek, latest.status;
end;
$function$;

-- Backfill every currently eligible player into the active gameweek. Existing
-- provider-backed rows win; these rows only turn an absent value into zero.
alter table public.league_player_scores
disable trigger apply_final_score_auto_substitutions;

with current_windows as (
  select distinct on (transaction_window.league_id)
    transaction_window.league_id,
    transaction_window.gameweek
  from public.league_transaction_windows transaction_window
  order by transaction_window.league_id, transaction_window.gameweek desc
), eligible_players as (
  select
    league.id as league_id,
    current_window.gameweek,
    player.id as player_id,
    case
      when private.gameweek_scoring_fixtures_final(
        league.id,
        current_window.gameweek::smallint
      )
        then 'final'
      else 'live'
    end as score_status
  from public.leagues league
  join current_windows current_window on current_window.league_id = league.id
  join public.players player
    on player.active
   and (
     (
       league.player_pool = 'All Top Five'
       and player.competition in (
         'Premier League', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1'
       )
     )
     or player.competition = league.player_pool
   )
)
insert into public.league_player_scores (
  league_id, gameweek, player_id, status, source,
  source_updated_at, updated_at
)
select
  eligible.league_id,
  eligible.gameweek,
  eligible.player_id,
  eligible.score_status,
  'player-pool-backfill',
  now(),
  now()
from eligible_players eligible
on conflict (league_id, gameweek, player_id) do nothing;

alter table public.league_player_scores
enable trigger apply_final_score_auto_substitutions;

commit;
