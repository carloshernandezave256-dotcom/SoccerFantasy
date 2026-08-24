alter table public.league_player_scores
  add column if not exists stats_received boolean not null default false;

comment on column public.league_player_scores.stats_received is
  'True only when the provider returned a fixture-player statistics row for this player in the league gameweek.';

update public.league_player_scores score
set stats_received = exists (
  select 1
  from public.league_headline_fixtures fixture
  join public.football_fixture_player_stats stats
    on stats.fixture_id = fixture.fixture_id
   and stats.player_id = score.player_id
  where fixture.league_id = score.league_id
    and fixture.gameweek = score.gameweek
);
