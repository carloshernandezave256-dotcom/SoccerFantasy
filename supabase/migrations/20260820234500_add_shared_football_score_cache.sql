-- Canonical provider cache. Automated synchronization reads and writes one row per
-- real fixture/player, then fans that data out to fantasy leagues without repeating
-- API-Football requests for each league.
create table if not exists public.football_fixture_cache (
  fixture_id bigint primary key,
  competition text not null,
  competition_id integer not null,
  season integer not null,
  gameweek integer not null,
  round_name text not null,
  kickoff timestamptz not null,
  status text not null,
  home_team text not null,
  away_team text not null,
  home_score integer,
  away_score integer,
  stats_synced_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists football_fixture_cache_live_window_idx
  on public.football_fixture_cache(kickoff,status);

create table if not exists public.football_fixture_player_stats (
  fixture_id bigint not null references public.football_fixture_cache(fixture_id) on delete cascade,
  player_id bigint not null references public.players(id) on delete cascade,
  rating numeric(4,2),
  minutes smallint not null default 0,
  goals smallint not null default 0,
  assists smallint not null default 0,
  shots_on_target smallint not null default 0,
  completed_passes smallint not null default 0,
  tackles_won smallint not null default 0,
  penalty_goals smallint not null default 0,
  penalties_missed smallint not null default 0,
  penalties_conceded smallint not null default 0,
  saves smallint not null default 0,
  penalties_saved smallint not null default 0,
  goals_conceded smallint not null default 0,
  yellow_cards smallint not null default 0,
  red_cards smallint not null default 0,
  man_of_the_match boolean not null default false,
  source_updated_at timestamptz not null default now(),
  primary key(fixture_id,player_id)
);

create index if not exists football_fixture_player_stats_player_idx
  on public.football_fixture_player_stats(player_id,fixture_id);

create table if not exists public.football_sync_state (
  singleton_id smallint primary key check(singleton_id=1),
  live_claimed_until timestamptz not null default '-infinity',
  updated_at timestamptz not null default now()
);
insert into public.football_sync_state(singleton_id) values(1) on conflict do nothing;

alter table public.football_fixture_cache enable row level security;
alter table public.football_fixture_player_stats enable row level security;
alter table public.football_sync_state enable row level security;

revoke all on table public.football_fixture_cache from anon,authenticated;
revoke all on table public.football_fixture_player_stats from anon,authenticated;
revoke all on table public.football_sync_state from anon,authenticated;
grant all on table public.football_fixture_cache to service_role;
grant all on table public.football_fixture_player_stats to service_role;
grant all on table public.football_sync_state to service_role;

-- Keep the unsafe legacy schedule stopped. Re-enable the new jobs only after its
-- deployment has been verified against the provider request budget.
do $$
declare existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname='sync-live-fantasy-scores';
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
  select jobid into existing_job from cron.job where jobname='refresh-football-schedules';
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
end
$$;
