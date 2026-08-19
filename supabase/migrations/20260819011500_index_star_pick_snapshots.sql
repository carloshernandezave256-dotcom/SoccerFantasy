create index if not exists lineup_gameweek_player_idx
  on public.lineup_gameweek_players(player_id);

create index if not exists lineup_gameweek_user_idx
  on public.lineup_gameweek_players(user_id);
