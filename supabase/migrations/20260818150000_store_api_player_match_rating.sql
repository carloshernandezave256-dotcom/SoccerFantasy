alter table public.league_player_scores
  add column if not exists rating numeric(4,2)
  check (rating is null or rating between 0 and 10);

comment on column public.league_player_scores.rating is
  'API-Football per-fixture player rating used to select and explain Man of the Match.';
