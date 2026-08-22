alter table public.football_fixture_sync_observations
  add column if not exists unmapped_players jsonb not null default '[]'::jsonb;

comment on column public.football_fixture_sync_observations.unmapped_players is
  'Provider player identities returned for the fixture but not found by api_football_id in public.players.';
