begin;

-- A completed scoring week must advance the entire fantasy league together.
-- This creates the next transaction window and gives every eligible player a
-- real zero row before the Market or Matchup pages switch to the new week.
create or replace function private.open_next_gameweek(
  p_league_id uuid,
  p_completed_gameweek smallint
) returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_next_gameweek integer;
begin
  if not private.gameweek_scoring_fixtures_final(
    p_league_id,
    p_completed_gameweek
  ) then
    return null;
  end if;

  perform private.refresh_league_calendar(p_league_id);

  select transaction_window.gameweek
  into v_next_gameweek
  from public.league_transaction_windows transaction_window
  where transaction_window.league_id = p_league_id
  order by transaction_window.gameweek desc
  limit 1;

  if v_next_gameweek is null
    or v_next_gameweek <= p_completed_gameweek
  then
    return null;
  end if;

  insert into public.league_player_scores (
    league_id,
    gameweek,
    player_id,
    status,
    source,
    source_updated_at,
    updated_at
  )
  select
    league.id,
    v_next_gameweek,
    player.id,
    'not_started',
    'gameweek-rollover',
    now(),
    now()
  from public.leagues league
  join public.players player
    on player.active
   and (
     (
       league.player_pool = 'All Top Five'
       and player.competition in (
         'Premier League',
         'La Liga',
         'Serie A',
         'Bundesliga',
         'Ligue 1'
       )
     )
     or player.competition = league.player_pool
   )
  where league.id = p_league_id
  on conflict (league_id, gameweek, player_id) do nothing;

  return v_next_gameweek;
end;
$function$;

revoke all on function private.open_next_gameweek(uuid, smallint)
from public, anon, authenticated;

-- Settlement remains the only rollover point. Scores, final-only rules,
-- substitutions and the completed matchup are committed before the next week
-- becomes visible to managers.
create or replace function public.settle_final_gameweek(
  p_league_id uuid,
  p_gameweek smallint
) returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_before integer := 0;
  v_inserted integer := 0;
  v_service_request boolean := coalesce((select auth.jwt() ->> 'role'), '') = 'service_role';
begin
  if not v_service_request then
    raise exception 'Service role required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_league_id::text || ':' || p_gameweek::text, 0)
  );

  if not private.gameweek_scoring_fixtures_final(p_league_id, p_gameweek) then
    return 0;
  end if;

  perform private.snapshot_gameweek_lineups(p_league_id, p_gameweek);

  if exists (
    select 1
    from public.lineup_gameweek_players snapshot
    left join public.league_player_scores score
      on score.league_id = snapshot.league_id
     and score.gameweek = snapshot.gameweek
     and score.player_id = snapshot.player_id
    where snapshot.league_id = p_league_id
      and snapshot.gameweek = p_gameweek
      and score.player_id is null
  ) then
    raise exception 'Cannot settle gameweek: one or more locked players are missing score rows';
  end if;

  select count(*) into v_before
  from public.lineup_gameweek_substitutions substitution
  where substitution.league_id = p_league_id
    and substitution.gameweek = p_gameweek;

  update public.league_player_scores score
  set status = 'final',
      updated_at = now()
  where score.league_id = p_league_id
    and score.gameweek = p_gameweek
    and score.status <> 'final'
    and exists (
      select 1
      from public.lineup_gameweek_players snapshot
      where snapshot.league_id = score.league_id
        and snapshot.gameweek = score.gameweek
        and snapshot.player_id = score.player_id
    );

  perform private.apply_gameweek_auto_substitutions(p_league_id, p_gameweek);
  perform public.refresh_league_matchup_scores(p_league_id, p_gameweek);

  select count(*) - v_before into v_inserted
  from public.lineup_gameweek_substitutions substitution
  where substitution.league_id = p_league_id
    and substitution.gameweek = p_gameweek;

  perform private.open_next_gameweek(p_league_id, p_gameweek);

  return greatest(v_inserted, 0);
end;
$function$;

revoke all on function public.settle_final_gameweek(uuid, smallint)
from public, anon, authenticated;
grant execute on function public.settle_final_gameweek(uuid, smallint)
to service_role;

-- Repair completed leagues that settled before rollover was part of the same
-- transaction. The helper is idempotent, so reapplying cannot duplicate rows.
do $function$
declare
  league_window record;
begin
  for league_window in
    select distinct on (transaction_window.league_id)
      transaction_window.league_id,
      transaction_window.gameweek
    from public.league_transaction_windows transaction_window
    order by transaction_window.league_id, transaction_window.gameweek desc
  loop
    if private.gameweek_scoring_fixtures_final(
      league_window.league_id,
      league_window.gameweek::smallint
    )
      and exists (
        select 1
        from public.league_player_scores score
        where score.league_id = league_window.league_id
          and score.gameweek = league_window.gameweek
      )
      and not exists (
        select 1
        from public.league_player_scores score
        where score.league_id = league_window.league_id
          and score.gameweek = league_window.gameweek
          and score.status <> 'final'
      )
    then
      perform private.open_next_gameweek(
        league_window.league_id,
        league_window.gameweek::smallint
      );
    end if;
  end loop;
end;
$function$;

commit;
