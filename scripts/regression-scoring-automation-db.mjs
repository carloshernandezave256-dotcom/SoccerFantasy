// Focused real PostgreSQL (PGlite) regression. Provider HTTP, pg_net transport and
// cron scheduling are boundary doubles; settlement gates and journal SQL are real.
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const db = new PGlite();
const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const L = '30000000-0000-0000-0000-000000000001';
const U = '40000000-0000-0000-0000-000000000001';
let checks = 0;
const scalar = async (sql, args) => Object.values((await db.query(sql, args)).rows[0])[0];
const verify = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const rejects = async (sql, args, message) => { await assert.rejects(db.query(sql, args), message); checks++; };

try {
  for (const file of ['tests/market-bootstrap.sql', 'tests/scoring-bootstrap.sql',
    'migrations/20260918050601_hardened_scoring_finalization.sql',
    'migrations/20260918055758_isolate_late_week_settlement.sql',
    'migrations/20260918094000_batch_scoring_settlement.sql']) {
    await db.exec(await read(`supabase/${file}`));
  }
  await db.exec(`
    create schema net; create schema vault; create schema cron;
    create table net.requests(id bigint generated always as identity primary key, url text, timeout_milliseconds integer);
    create table net._http_response(id bigint, status_code integer, timed_out boolean, error_msg text);
    create function net.http_get(url text, headers jsonb, timeout_milliseconds integer) returns bigint language sql as $$
      insert into net.requests(url, timeout_milliseconds) values($1,$3) returning id $$;
    create table vault.decrypted_secrets(name text, decrypted_secret text);
    insert into vault.decrypted_secrets values('soccer_fantasy_cron_secret','synthetic-test-secret');
    create table cron.job(jobid bigint generated always as identity primary key, jobname text unique, schedule text, command text, active boolean default true);
    create function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as $$
      insert into cron.job(jobname,schedule,command) values($1,$2,$3)
      on conflict(jobname) do update set schedule=excluded.schedule,command=excluded.command returning jobid $$;
    create function cron.alter_job(job_id bigint, command text) returns void language sql as $$
      update cron.job set command=$2 where jobid=$1 $$;
    insert into cron.job(jobname,schedule,command,active) values
      ('sync-live-fantasy-scores','*/2 * * * *','old dispatch',true),
      ('recover-and-wrap-completed-gameweeks','43 * * * *','old dispatch',false);
    select set_config('request.jwt.claim.role','service_role',false);
  `);
  await db.exec(await read('supabase/migrations/20261021180402_track_scoring_completion_and_retry_settlement.sql'));
  verify((await db.query('select schedule,active from cron.job order by jobid')).rows, [
    {schedule:'*/2 * * * *',active:true}, {schedule:'43 * * * *',active:false}, {schedule:'*/5 * * * *',active:true},
  ], 'Existing schedule and active flags are preserved');
  verify(await scalar("select command from cron.job where jobname='watch-scoring-completion'"),
    "set lock_timeout = '5s'; set statement_timeout = '60s'; select private.watch_scoring_completion();",
    'Scheduled watchdog has bounded lock and statement timeouts');
  verify((await scalar('select public.scoring_automation_health()')).watchdogStale, true);

  await db.exec(`
    insert into leagues values('${L}','draft','Premier League','Premier League');
    insert into league_transaction_windows(league_id,gameweek,roster_lock_at) values
      ('${L}',1,now()-interval '1 day'),('${L}',2,now()+interval '7 days');
    insert into players values(101,true,'GK','A');
    insert into lineup_gameweek_players values('${L}',1,'${U}',101,true,true,1,now());
  `);
  const pending = async () => (await db.query('select * from public.pending_gameweek_settlements()')).rows;
  verify((await pending()).map(p => p.gameweek), [1], 'No provider/cache row needed; future windows excluded');
  verify((await pending())[0].diagnostics.membershipFrozen, false, 'Read does not freeze membership');
  await db.exec(`
    insert into private.gameweek_fixture_sets values('${L}',1,now()-interval '2 days',now()+interval '5 days');
    insert into private.gameweek_fixture_members values('${L}',1,7,'Premier League',1,now()-interval '1 day');
    insert into league_headline_fixtures values('${L}',7,'Premier League',1,now()-interval '1 day','FT');
    select public.record_fixture_stat_evidence(7,now(),true,'Complete',array[101]::bigint[]);
  `);
  for (const reason of ['SportMonks refresh in progress', 'Provider refresh in progress']) {
    await db.query("update private.fixture_stat_evidence set reason=$1,observed_at=now()-interval '11 minutes' where fixture_id=7", [reason]);
    verify((await pending())[0].diagnostics.fixtures[0].staleAttempt, true, `${reason} is flagged when stale`);
    await db.query('update private.fixture_stat_evidence set observed_at=now() where fixture_id=7');
    verify((await pending())[0].diagnostics.fixtures[0].staleAttempt, false, `${reason} is not flagged while fresh`);
  }
  await db.exec("update private.fixture_stat_evidence set reason='Complete' where fixture_id=7");
  verify((await pending())[0].fixtures_ready, false, 'Evidence flag without matching stored stats is not proof');
  const stamp = await scalar('select observed_at from private.fixture_stat_evidence where fixture_id=7');
  await db.query('insert into football_fixture_player_stats values(7,101,$1)', [stamp]);
  verify((await pending())[0].fixtures_ready, true);
  verify((await pending())[0].settlement_ready, false, 'Missing score requires publication');
  await db.query(`insert into league_player_scores(league_id,gameweek,player_id,status,data_complete,source_updated_at)
    values($1,1,101,'final',true,$2::timestamptz-interval '1 second')`, [L,stamp]);
  verify((await pending())[0].diagnostics.pendingLockedPlayers[0].stale, true);
  await db.query('update league_player_scores set source_updated_at=$1', [stamp]);
  verify((await pending())[0].settlement_ready, true);
  verify((await db.query('select * from public.pending_scoring_fixtures()')).rows, [], 'No provider candidates while settlement is ready');
  verify((await pending()).length, 1, 'Independent retry still discovers the league');

  const watchdog = () => scalar('select private.watch_scoring_completion()');
  verify((await watchdog()).retryRunId, null, 'Explicitly paused wrap job remains paused');
  await db.exec("update cron.job set active=true where jobname='recover-and-wrap-completed-gameweeks'");
  const initialWatch = await watchdog();
  verify(initialWatch.proofReadyWeeks, 1);
  verify(initialWatch.settlementReadyWeeks, 1);
  assert.ok(initialWatch.retryRunId); checks++;
  const queued = initialWatch.retryRunId;
  verify(await scalar('select status from private.scoring_runs where id=$1',[queued]), 'queued');
  verify(await scalar('select count(*)::int from net.requests'), 1);
  await watchdog();
  verify(await scalar('select count(*)::int from net.requests'), 1, 'Watchdog retry is bounded, not duplicated');
  await db.exec('insert into net._http_response select request_id,200,false,null from private.scoring_runs');
  verify((await watchdog()).jobs['wrap-gameweeks'].lastCompletedAt, null, 'Transport HTTP 200 is not application completion');
  verify(await scalar('select public.start_scoring_run($1,$2)', ['wrap-gameweeks',queued]), queued);
  await rejects('select public.start_scoring_run($1,$2)', ['scores',queued], /missing, already claimed/);
  await rejects('select public.start_scoring_run($1,$2)', ['wrap-gameweeks',queued], /already claimed/);
  await db.query('select public.finish_scoring_run($1,$2,$3,$4)', [queued,'completed',JSON.stringify({settled:1}),null]);
  await db.query('select public.finish_scoring_run($1,$2,$3,$4)', [queued,'completed',JSON.stringify({settled:99}),null]);
  verify(await scalar('select summary from private.scoring_runs where id=$1',[queued]), {settled:1}, 'Duplicate finish preserves first outcome');
  verify((await watchdog()).jobs['wrap-gameweeks'].completionOverdue, false);
  await db.exec(`insert into finalized_gameweek_locks values('${L}',1)`);
  verify(await pending(), [], 'Finalized weeks are never re-enqueued');
  verify((await scalar(`select public.gameweek_reconciliation_status('${L}',1::smallint)`)).settlementReady, false);

  const skipped = await scalar("select public.start_scoring_run('scores')");
  await db.query("select public.finish_scoring_run($1,'skipped')", [skipped]);
  verify((await watchdog()).jobs.scores.lastCompletedAt, null, 'Skipped lease is not substantive success');
  const failed = await scalar("select private.enqueue_scoring_run('scores')");
  verify(await scalar("select private.enqueue_scoring_run('scores')"), null, 'Active dispatch cannot be duplicated');
  await db.query('insert into net._http_response select request_id,502,false,null from private.scoring_runs where id=$1', [failed]);
  await watchdog();
  verify(await scalar('select status from private.scoring_runs where id=$1',[failed]), 'failed');
  verify((await watchdog()).jobs.scores.failedRunsLastHour, 1);
  const staleQueue = await scalar("select private.enqueue_scoring_run('scores')");
  await db.query("update private.scoring_runs set queued_at=now()-interval '11 minutes' where id=$1", [staleQueue]);
  await watchdog();
  verify(await scalar('select status from private.scoring_runs where id=$1',[staleQueue]), 'failed');
  const staleRun = await scalar("select public.start_scoring_run('scores')");
  await db.query("update private.scoring_runs set started_at=now()-interval '11 minutes' where id=$1", [staleRun]);
  await watchdog();
  verify(await scalar('select status from private.scoring_runs where id=$1',[staleRun]), 'failed');
  await rejects("select public.finish_scoring_run($1,'completed')", [staleRun], /not running/);
  await db.exec('delete from vault.decrypted_secrets');
  const dispatchFailure = await scalar("select private.enqueue_scoring_run('scores')");
  verify(await scalar('select status from private.scoring_runs where id=$1',[dispatchFailure]), 'failed', 'Dispatch failure is durably recorded');
  verify((await scalar('select public.scoring_automation_health()')).watchdogStale, false);

  // Retention never lets two-minute journal writes grow forever, nor erases the
  // last successful application acknowledgment when a job has stopped for months.
  await db.exec(`insert into private.scoring_runs(job_name,status,queued_at,finished_at,summary)
    select 'scores','skipped',now()-interval '100 days',now()-interval '100 days','{"retentionTest":true}'::jsonb
    from generate_series(1,1005);
    insert into private.scoring_runs(job_name,status,queued_at,finished_at,summary) values
      ('scores','completed',now()-interval '101 days',now()-interval '101 days','{"retentionTest":true}'),
      ('scores','completed',now()-interval '102 days',now()-interval '102 days','{"retentionTest":true}');`);
  const retainedSuccess = await scalar("select max(finished_at) from private.scoring_runs where job_name='scores' and status='completed'");
  verify((await watchdog()).prunedTerminalRuns, 1000, 'A pass deletes at most 1,000 expired terminal runs');
  verify(await scalar("select count(*)::int from private.scoring_runs where summary->>'retentionTest'='true'"), 7);
  const retainedHealth = await watchdog();
  verify(retainedHealth.prunedTerminalRuns, 6);
  verify(retainedHealth.journalRetentionDays, 90);
  verify(await scalar("select max(finished_at) from private.scoring_runs where job_name='scores' and status='completed'"), retainedSuccess,
    'Latest completed record survives even outside retention');
  verify(await scalar('select status from private.scoring_runs where id=$1',[dispatchFailure]), 'failed', 'Recent failure debugging is preserved');
  verify(retainedHealth.jobs.scores.completionOverdue, true, 'Retained old success still reports unhealthy freshness');
  await db.exec(`insert into private.scoring_runs(job_name,status,queued_at,finished_at) values
    ('wrap-gameweeks','failed',now()-interval '101 days',now()-interval '101 days'),
    ('wrap-gameweeks','failed',now()-interval '102 days',now()-interval '102 days');`);
  const retainedFailure = await scalar("select max(finished_at) from private.scoring_runs where job_name='wrap-gameweeks' and status='failed'");
  const unfinished = await scalar("select public.start_scoring_run('scores')");
  verify((await watchdog()).prunedTerminalRuns, 1);
  verify(await scalar("select max(finished_at) from private.scoring_runs where job_name='wrap-gameweeks' and status='failed'"), retainedFailure,
    'Latest failed record also survives outside retention');
  verify(await scalar('select status from private.scoring_runs where id=$1',[unfinished]), 'running', 'Unfinished run remains tracked');

  await db.exec("select set_config('request.jwt.claim.role','authenticated',false)");
  await rejects('select public.pending_gameweek_settlements()', [], /Service role required/);
  await rejects("select public.start_scoring_run('scores')", [], /Service role required/);
  await db.exec('set role authenticated');
  for (const sql of ['select public.pending_gameweek_settlements()', "select public.start_scoring_run('scores')",
    'select public.scoring_automation_health()', 'select * from private.scoring_runs',
    'select private.watch_scoring_completion()', "select private.enqueue_scoring_run('scores')"]) {
    await rejects(sql, [], /permission denied/);
  }
  await db.exec('reset role');
  verify(await scalar(`select bool_and(relrowsecurity) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='private' and c.relname in ('scoring_runs','scoring_watchdog_state')`), true);
  console.log(`${checks} scoring automation PostgreSQL checks passed: independent discovery, proof gates, durable completion, bounded retry, watchdog and privileges.`);
} finally { await db.close(); }
