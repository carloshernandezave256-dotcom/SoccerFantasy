alter table public.players
  add column if not exists fotmob_id bigint,
  add column if not exists fotmob_expected_return text,
  add column if not exists fotmob_return_checked_at timestamptz;

comment on column public.players.fotmob_id is 'Cached FotMob player identifier used only for return-date enrichment.';
comment on column public.players.fotmob_expected_return is 'FotMob expected-return label, preserving fuzzy windows such as Early September 2026.';
comment on column public.players.fotmob_return_checked_at is 'Last time FotMob return-date enrichment was checked for this player.';
