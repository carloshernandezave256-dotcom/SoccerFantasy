create table if not exists public.league_headline_fixtures (
  league_id uuid not null references public.leagues(id) on delete cascade,
  fixture_id bigint not null,
  gameweek integer not null,
  competition text not null,
  round_name text not null,
  kickoff timestamptz not null,
  status text not null,
  home_team text not null,
  away_team text not null,
  home_score integer,
  away_score integer,
  updated_at timestamptz not null default now(),
  primary key (league_id,fixture_id)
);

create index if not exists league_headline_fixtures_week_idx
  on public.league_headline_fixtures(league_id,gameweek,kickoff);

alter table public.league_headline_fixtures enable row level security;

grant select on table public.league_headline_fixtures to authenticated;
grant all on table public.league_headline_fixtures to service_role;

drop policy if exists "League members can view synced headline fixtures" on public.league_headline_fixtures;
create policy "League members can view synced headline fixtures"
on public.league_headline_fixtures
for select to authenticated
using ((select private.is_league_member(league_id)));
