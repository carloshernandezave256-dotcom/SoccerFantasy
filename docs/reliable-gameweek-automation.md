# Reliable gameweek completion

## Scope

This repair does not change scoring rules, lineup/autosub selection, archived
results, waiver deadlines or security permissions. It makes scheduled completion
observable and retryable after provider matches stop being live.

- Both score and wrap routes share one authenticated pipeline. Returned provider
  or publication failures are HTTP 502, never an HTTP 200 success wrapper.
- Already-reconciled locked weeks retry publication without another provider
  fetch. Ingestion is batched before one publication per affected week, with
  per-fixture and per-league failure isolation. A route-bounded lease covers
  publication, and a failed worker is reclaimable after a bounded interval.
- The private run journal tracks queued, running, completed, failed and skipped
  separately, records pg_net request/status observations, and requires an actual
  application completion acknowledgment. Enqueue or HTTP 200 alone is not success.
- A five-minute database watchdog records pending proof/score diagnostics and
  retries proof-ready weeks independently of provider cadence. Existing two-minute
  live and hourly wrap schedules, including paused status, are preserved.
- Journal summaries are bounded. Terminal history is kept for 90 days, retaining
  each job's latest success/failure and the current health snapshot. Cleanup is
  limited per pass; unfinished work is never removed by retention.
- Developer-only GET /api/developer/scoring-health reads persisted health and
  explicitly reports a stale watchdog. Existing gameweek diagnostics include
  missing/stale score evidence and both old/new provider-refresh reason strings.
- Identity mapping reports explicit missing/ambiguous/conflicting evidence,
  preserves reviewed crosswalks, and only corroborates transfers with stored
  profile identity evidence. It does not create players, guess duplicate aliases
  or silently convert unknown statistics into zeroes.
- The latest failed provider payload is retained, with imported_at cleared until
  success. Explicit null scoring data cannot certify final statistics.

## Validation

Run npm test, npm run test:db, npm run test:scoring:db,
node scripts/regression-sportmonks-db.mjs, npm run test:rollover:db,
npm run test:automation:db, npm run typecheck and npm run build.
Run npm run test:scoring:concurrency with TEST_DATABASE_URL pointing ONLY to a
throwaway PostgreSQL server. CI provides PostgreSQL 16.

The new rollover harness loads the real current snapshot, matchup, archive,
autosubstitution, settlement, open_next_gameweek and delayed-calendar SQL.
It covers complete 18-player squads, same-position bench priority, captain DNP,
unchanged deadlines, next-round preservation, missing/null/stale proof, membership
freeze, immutable archives, rollback after calendar failure and idempotent retry.
A provider-to-publication replay runs the real SportMonks normalizer, SQL fixture
calculator, weekly JS aggregation and SQL settlement/rollover, preserving
per-match scoring thresholds and ledgers. Synthetic provider squads are used;
this is not a claim that incomplete live provider data has become complete.

The two-connection PostgreSQL test covers actual archive/window visibility and
concurrent publication, not a stubbed rollover. PGlite does not replace that gate.
Focused automation tests use transport/cron doubles but real journal and proof SQL.

## Production gate and verification

Apply the two new reviewed migrations and deploy this app together only after
explicit approval and passing CI. No unrelated trade changes are included.
The database migration references the existing scoring cron secret in Vault;
no new credential, security setting or audience is introduced.

After deployment verify the exact production commit, migration versions, run
queued/running/terminal transitions, watchdog freshness and completion status.
Recheck fixture evidence, finalization locks, lineup substitutions and next-week
window/deadlines. Provider identity or statistical gaps must remain blocked until
corroborated; never force finalization or move the waiver deadline to hide a delay.
A successful software deployment is not proof the live week settled.
