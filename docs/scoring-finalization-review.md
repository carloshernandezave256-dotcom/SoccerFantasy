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
