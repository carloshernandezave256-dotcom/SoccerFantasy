begin;

-- Once every scoring fixture is terminal, no player-pool score may keep the
-- completed matchup live. This includes players who were not in a locked XI.
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
    and score.status <> 'final';

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

-- Complete and advance weeks that settled under the older lineup-only final
-- marker. The service claim exists only inside this migration transaction.
do $function$
declare
  league_window record;
begin
  perform set_config(
    'request.jwt.claims',
    '{"role":"service_role"}',
    true
  );

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
    then
      perform public.settle_final_gameweek(
        league_window.league_id,
        league_window.gameweek::smallint
      );
    end if;
  end loop;
end;
$function$;

commit;
