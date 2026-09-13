# Weekend score selection repair

Production diagnosis: fantasy Week 4's Saturday-based seven-day window excluded
Friday September 11. It also contained nine La Liga round 5 and nine round 6
fixtures; the higher-round tie break selected the future round 6. Subsequent
refreshes replaced recovered round 5 scores with missing-stat zero rows.

The shared selector now starts weekend windows on Friday and chooses each
competition's dominant Friday–Monday round. Later fixtures of that selected
round remain eligible through Thursday; different rounds remain excluded.
An explicitly configured calendar round never falls back to another round.
Manual sync, scheduled sync, and the wrap job already call this helper.

Verification: full existing suite plus regression coverage for Friday starts,
future midweek rounds, catch-up exclusion, delayed finishes, repeated league
refresh, and corrected provider stats. Production build succeeds.

Deployment follow-up: deploy this commit before recovering live Week 4 scores.
Then rebuild using the selected fixtures and stored provider statistics, refresh
matchup totals, and verify Konaté and Barcelona again after a scheduled refresh.
The prior one-time recovery is audited in private.scoring_repair_audit under
week4-score-recovery-20260913. Do not rerun it as a permanent solution.

This patch does not change scoring weights, finalized-week locks, or the separate
database waiver/settlement calendar implementation. Gateway timeout diagnosis
remains separate. No production data or deployment changed in this commit.
