-- Scores restored from an approved alternate provider or manual reconciliation
-- may not have a matching API-Football raw-stat row, but their stored match
-- evidence still confirms that final player statistics were received.
update public.league_player_scores
set stats_received = true
where not stats_received
  and (
    minutes > 0
    or rating is not null
    or fantasy_points <> 0
    or jsonb_array_length(coalesce(score_ledger, '[]'::jsonb)) > 0
  );
