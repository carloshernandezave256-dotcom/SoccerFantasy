begin;

-- The live-score worker calls this only after the provider payload and the
-- derived league score rows have been stored. A fixture status trigger is too
-- early for settlement because fixture state is persisted before player stats.
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

  -- Never invent a zero score for a missing player. Failing here keeps the
  -- week retryable and makes a broken ingestion visible in the cron logs.
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

  -- At this point every scoring fixture is terminal and the final provider
  -- snapshot has already been stored. Re-running the canonical row trigger
  -- adds final-only rules such as clean sheets before substitutions are ranked.
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

  return greatest(v_inserted, 0);
end;
$function$;

revoke all on function public.settle_final_gameweek(uuid, smallint)
from public, anon, authenticated;
grant execute on function public.settle_final_gameweek(uuid, smallint)
to service_role;

commit;
