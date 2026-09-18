create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- A verified matchday-squad absence is explicit DNP evidence even though no
-- provider stat row exists. Unknown/missing provider data must still stay pending.
create or replace function public.settle_final_gameweek(p_league_id uuid, p_gameweek smallint)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_before integer := 0;
  v_inserted integer := 0;
  v_service_request boolean := coalesce((select auth.jwt() ->> 'role'), '') = 'service_role';
begin
  if not v_service_request then raise exception 'Service role required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_league_id::text || ':' || p_gameweek::text, 0));
  if exists (select 1 from public.finalized_gameweek_locks lock where lock.league_id=p_league_id and lock.gameweek=p_gameweek) then return 0; end if;
  if not private.gameweek_scoring_fixtures_final(p_league_id,p_gameweek) then return 0; end if;
  perform private.snapshot_gameweek_lineups(p_league_id,p_gameweek);
  if exists (
    select 1 from public.lineup_gameweek_players snapshot
    left join public.league_player_scores score
      on score.league_id=snapshot.league_id and score.gameweek=snapshot.gameweek and score.player_id=snapshot.player_id
    where snapshot.league_id=p_league_id and snapshot.gameweek=p_gameweek and score.player_id is null
  ) then raise exception 'Cannot settle gameweek: one or more locked players are missing score rows'; end if;

  -- Require either a real provider stat row or an explicit matchday-squad DNP
  -- verification. A generic final zero is not sufficient evidence.
  if exists(
    select 1
    from public.lineup_gameweek_players lp
    join public.league_player_scores s
      on s.league_id=lp.league_id and s.gameweek=lp.gameweek and s.player_id=lp.player_id
    where lp.league_id=p_league_id and lp.gameweek=p_gameweek
      and not (
        coalesce(s.stats_received,false)
        or (
          s.status='final'
          and s.source in (
            'fotmob-verified-not-in-matchday-squad',
            'api-football-verified-not-in-matchday-squad'
          )
          and s.minutes=0
          and s.fantasy_points=0
        )
      )
  ) then return 0; end if;

  select count(*) into v_before
  from public.lineup_gameweek_substitutions
  where league_id=p_league_id and gameweek=p_gameweek;

  update public.league_player_scores
  set status='final',updated_at=now()
  where league_id=p_league_id and gameweek=p_gameweek and status<>'final';

  perform private.apply_gameweek_auto_substitutions(p_league_id,p_gameweek);
  perform public.refresh_league_matchup_scores(p_league_id,p_gameweek);

  select count(*)-v_before into v_inserted
  from public.lineup_gameweek_substitutions
  where league_id=p_league_id and gameweek=p_gameweek;

  perform private.lock_finalized_gameweek(p_league_id,p_gameweek);
  perform private.open_next_gameweek(p_league_id,p_gameweek);
  return greatest(v_inserted,0);
end;
$function$;

do $$
declare existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname='recover-and-wrap-completed-gameweeks';
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
end
$$;

-- Retry old terminal fixtures and close any completed fantasy week that was held
-- open by missing provider rows. This stays out of the high-frequency live path.
select cron.schedule(
  'recover-and-wrap-completed-gameweeks',
  '43 * * * *',
  $job$
    select net.http_get(
      url := 'https://myfantasyxi.com/api/cron/wrap-gameweeks',
      headers := jsonb_build_object(
        'Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='soccer_fantasy_cron_secret' limit 1)
      ),
      timeout_milliseconds := 300000
    );
  $job$
);
