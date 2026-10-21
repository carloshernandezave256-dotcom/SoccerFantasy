-- Synthetic tables for an integration of the real settlement, archive and
-- rollover functions. Unlike scoring-bootstrap.sql, this harness contains no
-- function doubles. Production implementations are loaded by the test runner.
-- It is intentionally not a replay/certification of the entire Supabase schema.
create schema auth;
create schema private;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;
create function auth.uid() returns uuid language sql as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
create function auth.jwt() returns jsonb language sql as $$
  select jsonb_build_object('role',current_setting('request.jwt.claim.role',true))
$$;
create table auth.users(id uuid primary key);
create table public.leagues(
  id uuid primary key,
  game_format text not null,
  calendar_competition text not null,
  player_pool text not null,
  lineup_lock_minutes integer not null default 0
);
create table public.league_members(
  league_id uuid not null references public.leagues,
  user_id uuid not null references auth.users,
  waiver_priority integer,
  primary key(league_id,user_id)
);
create table public.drafts(
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues,
  status text not null
);
create table public.players(
  id bigint primary key,
  active boolean not null default true,
  position text not null,
  club text,
  competition text not null
);
create table public.draft_picks(
  league_id uuid not null references public.leagues,
  user_id uuid not null references auth.users,
  player_id bigint not null references public.players,
  pick_number integer,
  unique(league_id,player_id)
);
create table public.pack_cards(league_id uuid,user_id uuid,player_id bigint,active_slot integer);
create table public.league_transaction_windows(
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues,
  gameweek integer not null check(gameweek>0),
  waiver_process_at timestamptz not null,
  roster_lock_at timestamptz not null,
  player_market_lock_at timestamptz,
  priority_randomized_at timestamptz,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(league_id,gameweek),
  check(waiver_process_at<roster_lock_at)
);
create table public.league_headline_fixtures(
  league_id uuid not null references public.leagues,
  fixture_id bigint not null,
  competition text not null,
  gameweek smallint not null,
  kickoff timestamptz,
  status text,
  primary key(league_id,fixture_id)
);
create table public.football_fixture_player_stats(
  fixture_id bigint not null,
  player_id bigint not null,
  source_updated_at timestamptz,
  primary key(fixture_id,player_id)
);
create table public.football_fixture_cache(
  fixture_id bigint primary key,status text,kickoff timestamptz,events_synced_at timestamptz
);
create table public.lineup_players(
  league_id uuid not null references public.leagues,
  user_id uuid not null references auth.users,
  player_id bigint not null references public.players,
  is_starter boolean not null,
  is_captain boolean not null default false,
  pitch_order smallint,
  bench_order smallint,
  updated_at timestamptz not null default now(),
  primary key(league_id,user_id,player_id)
);
create unique index lineup_pitch_order_unique on public.lineup_players(league_id,user_id,pitch_order) where pitch_order is not null;
create unique index lineup_bench_order_unique on public.lineup_players(league_id,user_id,bench_order) where bench_order is not null;
create unique index lineup_captain_unique on public.lineup_players(league_id,user_id) where is_captain;
create table public.lineup_gameweek_players(
  league_id uuid not null references public.leagues,
  gameweek smallint not null,
  user_id uuid not null references auth.users,
  player_id bigint not null references public.players,
  is_starter boolean not null,
  is_star_pick boolean not null default false,
  pitch_order smallint,
  captured_at timestamptz not null default now(),
  primary key(league_id,gameweek,user_id,player_id)
);
create unique index lineup_gameweek_one_star_pick_idx on public.lineup_gameweek_players(league_id,gameweek,user_id) where is_star_pick;
create table public.lineup_gameweek_substitutions(
  league_id uuid not null references public.leagues,
  gameweek smallint not null,
  user_id uuid not null references auth.users,
  outgoing_player_id bigint not null references public.players,
  incoming_player_id bigint not null references public.players,
  position text not null,
  outgoing_pitch_order smallint,
  incoming_bench_order smallint,
  incoming_points numeric not null,
  applied_at timestamptz not null default now(),
  carried_to_lineup_at timestamptz,
  primary key(league_id,gameweek,user_id,outgoing_player_id),
  unique(league_id,gameweek,user_id,incoming_player_id),
  check(outgoing_player_id<>incoming_player_id)
);
create table public.league_player_scores(
  league_id uuid not null references public.leagues,
  gameweek smallint not null,
  player_id bigint not null references public.players,
  status text,source text,source_updated_at timestamptz,updated_at timestamptz,
  score_ledger jsonb,calculator_version text,stats_received boolean,
  man_of_the_match boolean,rating numeric,minutes integer,goals integer,assists integer,
  shots_on_target integer,big_chances_missed numeric,completed_passes integer,
  tackles_won integer,penalty_goals integer,penalties_missed integer,
  penalties_conceded integer,saves integer,penalties_saved integer,
  goals_conceded integer,yellow_cards integer,second_yellow_cards integer,
  red_cards integer,own_goals integer,fantasy_points numeric not null default 0,
  primary key(league_id,gameweek,player_id)
);
create table public.league_matchups(
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues,
  gameweek smallint not null,
  home_user_id uuid not null references auth.users,
  away_user_id uuid not null references auth.users,
  home_score numeric(8,2) not null default 0,
  away_score numeric(8,2) not null default 0,
  status text not null default 'scheduled',
  starts_at timestamptz,ends_at timestamptz,
  created_at timestamptz not null default now(),
  unique(league_id,gameweek,home_user_id,away_user_id)
);
-- Same membership helper used by the production matchup refresh function.
create function private.is_league_member(p_league_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.league_members where league_id=p_league_id and user_id=(select auth.uid()))
$$;
