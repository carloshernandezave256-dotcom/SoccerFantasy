# Trade integrity repair (R26 / R27)

This third batch is stacked locally on `fix/scoring-finalization` and retains both
prior repair batches (PR #7 and PR #8). It changes only trade-response SQL and
adds a focused PostgreSQL test harness. Nothing is merged or deployed.

## Changes

Trade acceptance now acquires the same league advisory mutex used by pickups and
scheduled waivers before locking a trade row. It locks both managers' ownership
rows in deterministic order, revalidates ownership and roster legality, and asserts
that the update moved exactly the expected number of players. An incomplete move
raises an exception, rolling back the entire statement, including lineup cleanup.

Acceptance also rechecks `trades_enabled` and both current memberships while holding
row locks. It uses wall-clock time after waiting for locks to reject expired or
post-kickoff requests. Declining an offer remains available when trading is disabled.

The adjacent pack-trade issue is repaired: only active cards actually being traded
remove their owner's lineup entry. Other managers' duplicate cards, the sender's
untraded active duplicate, and unrelated offers for another copy are preserved.
Conflicting pack offers are cancelled by card ID rather than by player ID.

## Verification

`npm run test:trades:db` runs the actual new function and existing SQL roster helper
in a disposable PGlite database with synthetic data. Cases cover valid exchange,
repeat acceptance, disabled trades, member departure, changed ownership, roster
limits, missing auth, wrong recipient, null input, expiration, transaction-start
versus wall-clock cutoff, conflicting offers, incomplete-write rollback, pack
copies and anonymous execution. A trigger checks the real PostgreSQL lock table
during ownership updates to verify an advisory mutex is held.

PGlite is single-session. These tests do not certify behavior under simultaneous
clients. Before release, run pickup-versus-trade and trade-versus-trade with two
real PostgreSQL sessions and verify that one succeeds and the other revalidates or
fails without partial changes. Include lock-timeout/deadlock rollback, counteroffers,
commissioner settings changes, and member removal. The existing scheduled waiver
processor locks a window before the league mutex; review that lock ordering during
the multi-session test, since it may cause a retryable deadlock. This batch does not
claim to fix all transaction entry points or the lineup snapshot race (R28).

Apply the timestamped migration only during a separately authorized release. This
function does not change scoring, fixture assignment, market deadlines, captain
rules, or the existing roster-legality policy. The earlier scoring batch's real
provider-data and concurrency release checks are still outstanding.
