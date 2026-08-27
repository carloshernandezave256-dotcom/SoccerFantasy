drop trigger if exists players_fotmob_return_fallback on public.players;
drop function if exists public.apply_fotmob_return_fallback();

update public.players
set expected_return = null
where fotmob_expected_return is not null
  and expected_return = fotmob_expected_return
  and expected_return !~ '^\\d{4}-\\d{2}-\\d{2}$';

comment on column public.players.expected_return is
  'Exact provider-derived return date when available; never populated from fuzzy FotMob estimates.';

comment on column public.players.fotmob_expected_return is
  'FotMob expected-return label, preserving fuzzy estimates such as Early September 2026.';
