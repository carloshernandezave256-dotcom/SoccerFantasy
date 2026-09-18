# Scoring and gameweek finalization repair

This branch builds on the first auction/waiver repair batch (PR #7), preserving
its source tree. It addresses R04, R14 and R48, and extends R11. It is not a claim
that architecture or the top-50 roadmap is complete. No production migration or
application deployment has been performed.

## Behavior

- A private, immutable membership list records the fixtures belonging to each
  league week at/after cutoff. The transaction window anchors its seven-day span.
  The calendar competition must match the exact fantasy round. Other competitions
  use the principal round beginning within that span; older-round catch-ups are
  excluded using their full cached round history. Missing competition schedules
  prevent freezing. Later fixture arrivals cannot extend the list.
- Scoring and settlement read that membership; lineup locking stays in force
  until verified settlement. A member fixture moved outside the original span is
  excluded. Postponed/cancelled/abandoned/awarded fixtures still unresolved at the
  end of the span are excluded. Their later catch-up statistics remain real-world
  history and cannot reopen or rewrite a finalized fantasy week.
- Provider refresh first withdraws the fixture's previous completeness evidence.
  Finalization requires both independently fetched team lineups to reconcile with
  mapped player statistics and explicit numeric minutes. Missing rows, mappings,
  squads or null minutes remain pending. An absent player can become a final DNP
  only after all eligible fixtures have this evidence (or are excluded).
- Both manual and scheduled score updates call `synchronizeFixtureScores`. It
  writes canonical per-fixture rows and sums those rows and ledgers per week.
  Existing SQL scoring calculations and captain multipliers are unchanged.
  Final own-goal events are fetched again to pick up corrections.
- Publication, evidence-version validation and settlement share a transaction.
  It refuses stale evidence or missing locked players, and returns without writing
  to an already finalized week. Substitutions retain same-position selection and
  do not transfer the captain bonus. Finalized corrections continue to require the
  existing explicit developer correction workflow.
- Unresolved old fixtures get up to ten hourly retry candidates per scheduler tick.
  The scheduler can settle an entirely excluded week without fetching a catch-up.
  Existing live-sync lease duration is unchanged (R10 remains outstanding).

## Verification

Run `npm test`, `npm run test:db`, `npm run test:scoring:db`, `npm run typecheck`,
and `npm run build`.

The scoring PostgreSQL harness executes the actual new migration and real
snapshot/auto-substitution/settlement bodies. It tests frozen cross-round fixture
membership, missing statistics, explicit DNP, captain substitution, replay,
corrected open-week data, finalized-week protection, stale evidence, postponed
fixtures and an all-excluded week. Matchup-total refresh, archive capture and
next-week scheduling are explicit boundary doubles. This is not a complete
historical migration replay, production RLS audit or multi-client concurrency test.

## Review and release requirements

1. Review this batch on top of PR #7; do not lose that batch when rebasing onto
   its eventual merge. The local first-batch commit has the same tree as PR #7's
   remote head, but a different commit ID.
2. Inspect complete season schedules and proposed fixture membership for each
   active league before enabling the migration. Existing finalized weeks are
   deliberately not backfilled. The initial snapshot depends on accurate cached
   schedules; no algorithm can reconstruct a lost original kickoff from a single
   rescheduled row alone.
3. Replay migrations and run concurrent publisher/reconciler tests in a disposable
   Supabase environment. The evidence locks are tested sequentially here.
4. Check a representative real provider response. This policy intentionally does
   not interpret null bench minutes as zero: providers that never send explicit
   nonappearance evidence will leave the week pending. That requires reconciliation,
   not bypassing the check or coercing missing values. Lineup endpoint reference:
   https://www.api-football.com/documentation-v3#tag/Fixtures/operation/get-fixtures-lineups
5. Apply the reviewed migration and deploy the app together when separately
   authorized. The new app requires its new RPCs. With the migration alone the old
   app cannot supply completeness evidence and settlement will remain pending.

The fixture labels/cache fix remains from PR #7. This batch also replaces the
misleading exact "reopens" time with a verified-results explanation on My Team.
No bulk rescore, ownership changes, or score-rule changes are included.

## September 18 consolidation (review gate, not deployed)

PR #8 is now consolidated onto main 766d967, preserving PR #7's market/cache fixes and main's later per-fixture deduplication. The unshipped original migration is replaced by `20260918050601_hardened_scoring_finalization.sql` so later existing migrations cannot overwrite its settlement guards. Do not apply the obsolete September 5 scoring migration.

Additional repairs:
- Frozen selection includes Friday for Saturday/Sunday calendar starts and selects the dominant opening-weekend round, with the lower round as tie-breaker. Older-round catch-ups remain excluded using full cached round history.
- The hourly wrap route now uses the same `synchronizeFixtureScores` implementation as manual and live cron updates; it cannot bypass completeness with legacy zero/DNP writes.
- Retry discovery freezes eligible windows without browser activity, and does not filter out weeks merely because matchup display labels say final.
- Calendar rollover requires the finalized settlement lock, preventing the next window from hiding an unfinished previous week.
- `GET /api/developer/gameweek-status?leagueId=<uuid>&gameweek=4` uses existing developer authentication. It reports membership freeze state, settlement state, fixture evidence/reasons, missing expected player IDs, pending locked players and attempts stuck longer than ten minutes. It never mutates state. No external alerts are configured.
- `test:scoring:concurrency` uses two native PostgreSQL connections and observes the second waiting on the first transaction, then verifies one settlement/substitution. The GitHub workflow provisions a disposable PostgreSQL 16 service. PGlite results alone do not satisfy this gate.

Null/default audit: provider normalization still uses numeric defaults for storage, but `fixtureCompleteness` independently rejects null/absent minutes or missing squad/mapping evidence. `buildLeaguePlayerScoreRows` can produce provisional zero totals; these have `data_complete=false` and cannot settle. Stored status remains `live` for compatibility; the diagnostics state is `pending`. SQL publication computes completeness itself rather than accepting caller flags. A genuine absent-player zero is allowed only after the entire eligible fixture set reconciles.

Release remains blocked until native concurrency CI passes, current provider payloads satisfy the strict squad policy, production fixture membership is reviewed, and the missed waiver-window policy is chosen. The current league's Week 4 contains an inactive locked Reijnders row with missing evidence; do not fabricate a zero. Applying the migration and deploying must be coordinated. No production migration, bulk rescore, merge, or deployment has been performed.
