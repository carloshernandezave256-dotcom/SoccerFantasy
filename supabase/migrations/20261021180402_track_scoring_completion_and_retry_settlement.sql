-- Dispatch is not completion. Keep a durable application acknowledgment separate
-- from pg_net's short-lived HTTP response and pg_cron's successful enqueue.
create table private.scoring_runs (
  id uuid primary key default gen_random_uuid(),
  job_name text not null check (job_name in ('scores', 'wrap-gameweeks')),
  status text not null check (status in ('queued', 'running', 'completed', 'failed', 'skipped')),
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  request_id bigint unique,
  http_status integer,
  summary jsonb not null default '{}'::jsonb,
  error text
);
create index scoring_runs_job_queued_idx on private.scoring_runs(job_name, queued_at desc);
create index scoring_runs_unfinished_idx on private.scoring_runs(queued_at)
  where status in ('queued', 'running');
create index scoring_runs_terminal_finished_idx on private.scoring_runs(finished_at, id)
  where status in ('completed', 'failed', 'skipped');
create index scoring_runs_job_status_finished_idx on private.scoring_runs(job_name, status, finished_at desc, id desc);
alter table private.scoring_runs enable row level security;
revoke all on private.scoring_runs from public, anon, authenticated, service_role;

create table private.scoring_watchdog_state (
  singleton boolean primary key default true check (singleton),
  checked_at timestamptz not null,
  diagnostics jsonb not null
);
alter table private.scoring_watchdog_state enable row level security;
revoke all on private.scoring_watchdog_state from public, anon, authenticated, service_role;

-- Mirror the existing settlement gate without freezing, publishing, changing
-- deadlines, or touching a finalized week. A final-looking flag alone is not
-- proof: every expected stat must match the evidence version, and every locked
-- player's final score must be at least as new as that version.
create function private.gameweek_settlement_diagnostics(p_league_id uuid, p_gameweek smallint)
returns jsonb language sql stable security definer set search_path = '' as $$
  with evidence as (
    select max(e.observed_at) as version
    from private.fixture_stat_evidence e
    join private.gameweek_fixture_members m using (fixture_id)
    where m.league_id = p_league_id and m.gameweek = p_gameweek
  ), locked as (
    select p.player_id, s.player_id is null as missing,
      not coalesce(s.data_complete, false) as incomplete,
      s.status is distinct from 'final' as non_final,
      s.source_updated_at is null or s.source_updated_at < e.version as stale
    from public.lineup_gameweek_players p
    left join public.league_player_scores s using (league_id, gameweek, player_id)
    cross join evidence e
    where p.league_id = p_league_id and p.gameweek = p_gameweek
  ), gate as (
    select private.gameweek_scoring_fixtures_final(p_league_id, p_gameweek) as fixtures_ready,
      exists(select 1 from locked) as has_lineup,
      not exists(select 1 from locked where missing or incomplete or non_final or stale) as scores_ready,
      exists(select 1 from public.finalized_gameweek_locks
        where league_id = p_league_id and gameweek = p_gameweek) as settled
  )
  select jsonb_build_object(
    'leagueId', p_league_id, 'gameweek', p_gameweek, 'checkedAt', now(),
    'state', case when g.settled then 'settled' else 'pending' end,
    'membershipFrozen', exists(select 1 from private.gameweek_fixture_sets
      where league_id = p_league_id and gameweek = p_gameweek),
    'fixturesReady', g.fixtures_ready,
    'settlementReady', not g.settled and g.fixtures_ready and g.has_lineup and g.scores_ready,
    'lockedLineupCount', (select count(*) from locked),
    'latestEvidenceAt', (select version from evidence),
    'pendingLockedPlayerIds', coalesce((select jsonb_agg(distinct player_id)
      from locked where missing or incomplete or non_final or stale), '[]'::jsonb),
    'pendingLockedPlayers', coalesce((select jsonb_agg(jsonb_build_object(
      'playerId', player_id, 'missing', missing, 'incomplete', incomplete,
      'nonFinal', non_final, 'stale', stale))
      from locked where missing or incomplete or non_final or stale), '[]'::jsonb),
    'fixtures', coalesce((select jsonb_agg(jsonb_build_object(
      'fixtureId', f.fixture_id, 'status', f.status,
      'complete', f.status = 'EXCLUDED' or (f.status in ('FT','AET','PEN')
        and coalesce(e.complete, false) and cardinality(e.player_ids) > 0
        and not exists(select 1 from unnest(e.player_ids) id where not exists(
          select 1 from public.football_fixture_player_stats s where s.fixture_id = f.fixture_id
            and s.player_id = id and s.source_updated_at = e.observed_at))),
      'lastAttemptAt', e.observed_at, 'reason', coalesce(e.reason, 'No reconciliation evidence'),
      'staleAttempt', e.reason in ('Provider refresh in progress', 'SportMonks refresh in progress')
        and e.observed_at < now() - interval '10 minutes',
      'missingPlayerIds', coalesce((select jsonb_agg(id) from unnest(e.player_ids) id where not exists(
        select 1 from public.football_fixture_player_stats s where s.fixture_id = f.fixture_id
          and s.player_id = id and s.source_updated_at = e.observed_at)), '[]'::jsonb)) order by f.fixture_id)
      from private.gameweek_scoring_fixtures(p_league_id, p_gameweek) f
      left join private.fixture_stat_evidence e using (fixture_id)), '[]'::jsonb)
  ) from gate g;
$$;
revoke all on function private.gameweek_settlement_diagnostics(uuid, smallint) from public, anon, authenticated, service_role;

create or replace function public.gameweek_reconciliation_status(p_league_id uuid, p_gameweek smallint)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then raise exception 'Service role required'; end if;
  return private.gameweek_settlement_diagnostics(p_league_id, p_gameweek);
end;
$$;

create function public.pending_gameweek_settlements()
returns table(league_id uuid, gameweek smallint, roster_lock_at timestamptz,
  fixtures_ready boolean, settlement_ready boolean, diagnostics jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then raise exception 'Service role required'; end if;
  return query
  with pending as materialized (
    select w.league_id, w.gameweek::smallint as gameweek, w.roster_lock_at,
      private.gameweek_settlement_diagnostics(w.league_id, w.gameweek::smallint) as diagnostic
    from public.league_transaction_windows w
    where w.roster_lock_at <= now() and not exists(
      select 1 from public.finalized_gameweek_locks f
      where f.league_id = w.league_id and f.gameweek = w.gameweek)
  )
  select p.league_id, p.gameweek, p.roster_lock_at,
    (p.diagnostic->>'fixturesReady')::boolean, (p.diagnostic->>'settlementReady')::boolean, p.diagnostic
  from pending p order by p.roster_lock_at, p.league_id, p.gameweek;
end;
$$;

create function public.start_scoring_run(p_job_name text, p_run_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then raise exception 'Service role required'; end if;
  if p_job_name is null or p_job_name not in ('scores', 'wrap-gameweeks') then raise exception 'Invalid scoring job'; end if;
  if p_run_id is null then
    insert into private.scoring_runs(job_name, status, started_at)
    values(p_job_name, 'running', now()) returning id into v_id;
  else
    update private.scoring_runs set status = 'running', started_at = now()
    where id = p_run_id and job_name = p_job_name and status = 'queued'
    returning id into v_id;
    if v_id is null then raise exception 'Scoring run is missing, already claimed, or belongs to another job'; end if;
  end if;
  return v_id;
end;
$$;

create function public.finish_scoring_run(p_run_id uuid, p_status text,
  p_summary jsonb default '{}'::jsonb, p_error text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_status text;
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then raise exception 'Service role required'; end if;
  if p_status is null or p_status not in ('completed', 'failed', 'skipped') then raise exception 'Invalid scoring outcome'; end if;
  select status into v_status from private.scoring_runs where id = p_run_id for update;
  if not found then raise exception 'Scoring run not found'; end if;
  if v_status = p_status then return; end if; -- Safe duplicate acknowledgment.
  if v_status <> 'running' then raise exception 'Scoring run is not running'; end if;
  update private.scoring_runs set status = p_status, finished_at = now(),
    summary = coalesce(p_summary, '{}'::jsonb), error = left(p_error, 2000)
  where id = p_run_id;
end;
$$;

revoke all on function public.gameweek_reconciliation_status(uuid, smallint),
  public.pending_gameweek_settlements(), public.start_scoring_run(text, uuid),
  public.finish_scoring_run(uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.gameweek_reconciliation_status(uuid, smallint),
  public.pending_gameweek_settlements(), public.start_scoring_run(text, uuid),
  public.finish_scoring_run(uuid, text, jsonb, text) to service_role;

-- Only the database scheduler may dispatch. The existing endpoint and Vault
-- credential are unchanged. No HTTP body, response body, or credential is logged.
create function private.enqueue_scoring_run(p_job_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_request_id bigint; v_secret text;
begin
  if p_job_name is null or p_job_name not in ('scores', 'wrap-gameweeks') then raise exception 'Invalid scoring job'; end if;
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('scoring-dispatch:' || p_job_name, 0)) then return null; end if;
  if exists(select 1 from private.scoring_runs where job_name = p_job_name
    and status in ('queued', 'running') and queued_at >= now() - interval '10 minutes') then return null; end if;
  insert into private.scoring_runs(job_name, status) values(p_job_name, 'queued') returning id into v_id;
  begin
    select decrypted_secret into v_secret from vault.decrypted_secrets
    where name = 'soccer_fantasy_cron_secret' limit 1;
    if nullif(v_secret, '') is null then raise exception 'Scoring cron credential is not configured'; end if;
    select net.http_get(
      url := 'https://myfantasyxi.com/api/cron/' || p_job_name || '?runId=' || v_id::text,
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
      timeout_milliseconds := 300000) into v_request_id;
    update private.scoring_runs set request_id = v_request_id where id = v_id;
  exception when others then
    update private.scoring_runs set status = 'failed', finished_at = now(),
      error = 'Dispatch failed (' || sqlstate || ')' where id = v_id;
  end;
  return v_id;
end;
$$;
revoke all on function private.enqueue_scoring_run(text) from public, anon, authenticated, service_role;

create function private.watch_scoring_completion()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_snapshot jsonb; v_retry uuid; v_ready integer; v_pruned integer;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('scoring-watchdog', 0)) then return null; end if;
  -- Preserve transport observations while pg_net still has them. Even HTTP 200
  -- is not completion unless the application explicitly acknowledged success.
  update private.scoring_runs r set http_status = h.status_code
  from net._http_response h where h.id = r.request_id and r.http_status is distinct from h.status_code;
  update private.scoring_runs r set status = 'failed', finished_at = now(),
    error = case when h.timed_out then 'HTTP request timed out before application completion'
      when h.error_msg is not null then 'HTTP transport failed before application completion'
      else 'HTTP ' || h.status_code || ' before application completion' end
  from net._http_response h where h.id = r.request_id and r.status in ('queued', 'running')
    and (coalesce(h.timed_out, false) or h.error_msg is not null or h.status_code >= 400);
  update private.scoring_runs set status = 'failed', finished_at = now(),
    error = case when status = 'queued' then 'No application start acknowledgment within 10 minutes'
      else 'No application completion acknowledgment within 10 minutes' end
  where status in ('queued', 'running') and coalesce(started_at, queued_at) < now() - interval '10 minutes';

  -- Keep three months of debugging history without unbounded two-minute logs.
  -- Retain each job's latest success/failure indefinitely for health continuity.
  -- Prune at most 1,000 terminal records per tick; unfinished work is never lost.
  with protected as materialized (
    select latest.id from (values ('scores','completed'), ('scores','failed'),
      ('wrap-gameweeks','completed'), ('wrap-gameweeks','failed')) wanted(job_name,status)
    cross join lateral (select r.id from private.scoring_runs r
      where r.job_name = wanted.job_name and r.status = wanted.status
      order by r.finished_at desc, r.id desc limit 1) latest
  ), expired as (
    select r.id from private.scoring_runs r
    where r.status in ('completed', 'failed', 'skipped')
      and r.finished_at < now() - interval '90 days'
      and r.id not in (select id from protected)
    order by r.finished_at, r.id limit 1000 for update skip locked
  )
  delete from private.scoring_runs r using expired e where r.id = e.id;
  get diagnostics v_pruned = row_count;

  -- Independent of pending provider fixtures and their live-window/hourly retry
  -- filters. Request at most one wrap retry each five minutes, only when stored
  -- fixture proof is ready. Actual publication/settlement remains in the app and
  -- its existing transaction-protected RPC, never in a second scoring engine.
  with pending as materialized (
    select w.league_id, w.gameweek, w.roster_lock_at,
      private.gameweek_settlement_diagnostics(w.league_id, w.gameweek::smallint) as d
    from public.league_transaction_windows w where w.roster_lock_at <= now()
    and not exists(select 1 from public.finalized_gameweek_locks f
      where f.league_id = w.league_id and f.gameweek = w.gameweek)
  )
  select count(*) filter(where (d->>'fixturesReady')::boolean)::integer,
    jsonb_build_object('pendingWeeks', count(*),
      'proofReadyWeeks', count(*) filter(where (d->>'fixturesReady')::boolean),
      'settlementReadyWeeks', count(*) filter(where (d->>'settlementReady')::boolean),
      'oldestPendingLockAt', min(roster_lock_at),
      'weeks', coalesce((select jsonb_agg(x.d) from
        (select d from pending order by roster_lock_at, league_id, gameweek limit 10) x), '[]'::jsonb))
  into v_ready, v_snapshot from pending;
  -- An explicitly paused recovery job must stay paused, including watchdog retries.
  if v_ready > 0 and exists(select 1 from cron.job
    where jobname = 'recover-and-wrap-completed-gameweeks' and active)
    and not exists(select 1 from private.scoring_runs
    where job_name = 'wrap-gameweeks' and queued_at > now() - interval '5 minutes') then
    v_retry := private.enqueue_scoring_run('wrap-gameweeks');
  end if;
  v_snapshot := v_snapshot || jsonb_build_object('retryRunId', v_retry,
    'journalRetentionDays', 90, 'prunedTerminalRuns', v_pruned, 'jobs',
    (select jsonb_object_agg(j.job_name, jsonb_build_object(
      'latestRun', (select to_jsonb(r) - 'summary' from private.scoring_runs r
        where r.job_name = j.job_name order by r.queued_at desc, r.id desc limit 1),
      'lastCompletedAt', (select max(finished_at) from private.scoring_runs r
        where r.job_name = j.job_name and r.status = 'completed'),
      'lastFailedAt', (select max(finished_at) from private.scoring_runs r
        where r.job_name = j.job_name and r.status = 'failed'),
      'failedRunsLastHour', (select count(*) from private.scoring_runs r
        where r.job_name = j.job_name and r.status = 'failed' and r.finished_at > now() - interval '1 hour'),
      'completionOverdue', not exists(select 1 from private.scoring_runs r
        where r.job_name = j.job_name and r.status = 'completed'
          and r.finished_at > now() - case when j.job_name = 'scores' then interval '15 minutes' else interval '2 hours' end)
    )) from (values ('scores'), ('wrap-gameweeks')) j(job_name)));
  insert into private.scoring_watchdog_state(singleton, checked_at, diagnostics)
  values(true, now(), v_snapshot) on conflict(singleton) do update
  set checked_at = excluded.checked_at, diagnostics = excluded.diagnostics;
  return v_snapshot;
end;
$$;
revoke all on function private.watch_scoring_completion() from public, anon, authenticated, service_role;

create function public.scoring_automation_health()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then raise exception 'Service role required'; end if;
  return coalesce((select jsonb_build_object('checkedAt', checked_at,
    'watchdogStale', checked_at < now() - interval '10 minutes', 'diagnostics', diagnostics)
    from private.scoring_watchdog_state where singleton),
    jsonb_build_object('checkedAt', null, 'watchdogStale', true, 'diagnostics', null));
end;
$$;
revoke all on function public.scoring_automation_health() from public, anon, authenticated;
grant execute on function public.scoring_automation_health() to service_role;

-- Existing schedules and their active flags are preserved; only the dispatch
-- command changes. Apply together with the application run-acknowledgment code.
do $$
declare v_job bigint;
begin
  select jobid into v_job from cron.job where jobname = 'sync-live-fantasy-scores';
  if v_job is null then
    perform cron.schedule('sync-live-fantasy-scores', '*/2 * * * *', $job$select private.enqueue_scoring_run('scores');$job$);
  else
    perform cron.alter_job(v_job, command := $job$select private.enqueue_scoring_run('scores');$job$);
  end if;
  select jobid into v_job from cron.job where jobname = 'recover-and-wrap-completed-gameweeks';
  if v_job is null then
    perform cron.schedule('recover-and-wrap-completed-gameweeks', '43 * * * *', $job$select private.enqueue_scoring_run('wrap-gameweeks');$job$);
  else
    perform cron.alter_job(v_job, command := $job$select private.enqueue_scoring_run('wrap-gameweeks');$job$);
  end if;
end;
$$;
select cron.schedule('watch-scoring-completion', '*/5 * * * *',
  $job$set lock_timeout = '5s'; set statement_timeout = '60s'; select private.watch_scoring_completion();$job$);
notify pgrst, 'reload schema';
