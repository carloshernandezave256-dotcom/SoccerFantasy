alter table public.lineup_players
  drop constraint if exists lineup_players_league_id_user_id_bench_order_key;

create unique index if not exists lineup_players_unique_bench_order_idx
  on public.lineup_players(league_id, user_id, bench_order)
  where bench_order is not null;
