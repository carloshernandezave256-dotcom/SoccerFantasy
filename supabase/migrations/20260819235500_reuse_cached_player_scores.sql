create index if not exists league_player_scores_cache_source_idx
  on public.league_player_scores (source, player_id, gameweek, source_updated_at desc, updated_at desc);

create or replace function private.copy_cached_league_scores(p_league_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_pool text;
  v_count integer := 0;
begin
  select player_pool into v_pool
  from public.leagues
  where id = p_league_id;

  if v_pool is null then return 0; end if;

  insert into public.league_player_scores (
    league_id, gameweek, player_id, rating, minutes, goals, assists,
    shots_on_target, big_chances_missed, completed_passes, tackles_won,
    penalty_goals, penalties_missed, penalties_conceded, saves,
    penalties_saved, goals_conceded, yellow_cards, second_yellow_cards,
    red_cards, own_goals, man_of_the_match, status, source,
    source_updated_at, updated_at
  )
  select
    p_league_id, cached.gameweek, cached.player_id, cached.rating,
    cached.minutes, cached.goals, cached.assists, cached.shots_on_target,
    cached.big_chances_missed, cached.completed_passes, cached.tackles_won,
    cached.penalty_goals, cached.penalties_missed, cached.penalties_conceded,
    cached.saves, cached.penalties_saved, cached.goals_conceded,
    cached.yellow_cards, cached.second_yellow_cards, cached.red_cards,
    cached.own_goals, cached.man_of_the_match, cached.status, cached.source,
    cached.source_updated_at, cached.updated_at
  from (
    select distinct on (score.gameweek, score.player_id)
      score.gameweek, score.player_id, score.rating, score.minutes,
      score.goals, score.assists, score.shots_on_target,
      score.big_chances_missed, score.completed_passes, score.tackles_won,
      score.penalty_goals, score.penalties_missed,
      score.penalties_conceded, score.saves, score.penalties_saved,
      score.goals_conceded, score.yellow_cards, score.second_yellow_cards,
      score.red_cards, score.own_goals, score.man_of_the_match,
      score.status, score.source, score.source_updated_at, score.updated_at
    from public.league_player_scores score
    join public.players player on player.id = score.player_id
    where score.league_id <> p_league_id
      and score.source = 'api-football-live'
      and (
        (v_pool = 'All Top Five' and player.competition in (
          'Premier League', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1'
        ))
        or player.competition = v_pool
      )
    order by score.gameweek, score.player_id,
      score.source_updated_at desc nulls last, score.updated_at desc
  ) cached
  on conflict (league_id, gameweek, player_id) do update
  set rating = excluded.rating,
      minutes = excluded.minutes,
      goals = excluded.goals,
      assists = excluded.assists,
      shots_on_target = excluded.shots_on_target,
      big_chances_missed = excluded.big_chances_missed,
      completed_passes = excluded.completed_passes,
      tackles_won = excluded.tackles_won,
      penalty_goals = excluded.penalty_goals,
      penalties_missed = excluded.penalties_missed,
      penalties_conceded = excluded.penalties_conceded,
      saves = excluded.saves,
      penalties_saved = excluded.penalties_saved,
      goals_conceded = excluded.goals_conceded,
      yellow_cards = excluded.yellow_cards,
      second_yellow_cards = excluded.second_yellow_cards,
      red_cards = excluded.red_cards,
      own_goals = excluded.own_goals,
      man_of_the_match = excluded.man_of_the_match,
      status = excluded.status,
      source = excluded.source,
      source_updated_at = excluded.source_updated_at,
      updated_at = excluded.updated_at
  where coalesce(excluded.source_updated_at, excluded.updated_at)
     >= coalesce(
       public.league_player_scores.source_updated_at,
       public.league_player_scores.updated_at
     );

  get diagnostics v_count = row_count;
  return v_count;
end
$$;

create or replace function private.populate_new_league_cache()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.copy_cached_league_scores(new.id);
  return new;
end
$$;

drop trigger if exists populate_new_league_cache on public.leagues;
create trigger populate_new_league_cache
after insert on public.leagues
for each row execute function private.populate_new_league_cache();

do $$
declare league_row record;
begin
  for league_row in select id from public.leagues loop
    perform private.copy_cached_league_scores(league_row.id);
  end loop;
end
$$;

revoke all on function private.copy_cached_league_scores(uuid), private.populate_new_league_cache() from public, anon, authenticated;
