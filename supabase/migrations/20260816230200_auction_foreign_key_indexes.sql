-- Cover auction foreign keys used during player/profile/league cleanup and joins.
create index if not exists auction_budgets_user_idx
  on public.auction_budgets(user_id);
create index if not exists auction_lots_player_idx
  on public.auction_lots(player_id);
create index if not exists auction_lots_nominator_idx
  on public.auction_lots(nominated_by);
create index if not exists auction_lots_current_bidder_idx
  on public.auction_lots(current_bidder_id);
create index if not exists auction_sessions_current_lot_idx
  on public.auction_sessions(current_lot_id);
create index if not exists auction_bids_league_idx
  on public.auction_bids(league_id);
create index if not exists auction_bids_user_idx
  on public.auction_bids(user_id);
