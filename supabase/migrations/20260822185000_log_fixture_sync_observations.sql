create table if not exists public.football_fixture_sync_observations (
  id bigint generated always as identity primary key,
  fixture_id bigint not null,
  observed_at timestamptz not null default now(),
  status text not null,
  home_score smallint,
  away_score smallint,
  provider_player_rows integer not null default 0,
  mapped_player_rows integer not null default 0
);

create index if not exists football_fixture_sync_observations_fixture_time_idx
  on public.football_fixture_sync_observations(fixture_id,observed_at desc);

alter table public.football_fixture_sync_observations enable row level security;
revoke all on public.football_fixture_sync_observations from anon,authenticated;
grant all on public.football_fixture_sync_observations to service_role;
