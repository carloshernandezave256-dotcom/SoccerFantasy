-- Initial relational foundation. Apply only after the application audit and RLS review.
create extension if not exists pgcrypto;

create type public.league_size as enum ('8', '10', '12');
create type public.member_role as enum ('manager', 'commissioner');
create type public.player_position as enum ('GK', 'DEF', 'MID', 'FWD');
create type public.draft_status as enum ('scheduled', 'live', 'paused', 'complete');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 40),
  created_at timestamptz not null default now()
);

create table public.leagues (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 60),
  invite_code text not null unique,
  size public.league_size not null default '10',
  commissioner_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.league_members (
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  team_name text not null check (char_length(team_name) between 2 and 40),
  role public.member_role not null default 'manager',
  draft_slot smallint,
  joined_at timestamptz not null default now(),
  primary key (league_id, user_id),
  unique (league_id, team_name),
  unique (league_id, draft_slot)
);

create table public.players (
  id bigint generated always as identity primary key,
  provider_id text not null unique,
  full_name text not null,
  position public.player_position not null,
  club text not null,
  competition text not null,
  active boolean not null default true
);

create table public.drafts (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null unique references public.leagues(id) on delete cascade,
  status public.draft_status not null default 'scheduled',
  rounds smallint not null default 18 check (rounds = 18),
  pick_seconds smallint not null default 60 check (pick_seconds between 15 and 300),
  current_pick smallint not null default 1,
  starts_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.draft_picks (
  id bigint generated always as identity primary key,
  draft_id uuid not null references public.drafts(id) on delete cascade,
  league_id uuid not null references public.leagues(id) on delete cascade,
  pick_number smallint not null,
  round smallint not null check (round between 1 and 18),
  user_id uuid not null references public.profiles(id),
  player_id bigint not null references public.players(id),
  auto_picked boolean not null default false,
  picked_at timestamptz not null default now(),
  unique (draft_id, pick_number),
  unique (league_id, player_id)
);

alter table public.profiles enable row level security;
alter table public.leagues enable row level security;
alter table public.league_members enable row level security;
alter table public.players enable row level security;
alter table public.drafts enable row level security;
alter table public.draft_picks enable row level security;

create policy "profiles readable by authenticated users" on public.profiles for select to authenticated using (true);
create policy "users update own profile" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy "active players readable" on public.players for select to authenticated using (active = true);

-- League-scoped policies and transactional draft RPCs are intentionally deferred
-- until the exact commissioner and guest-access behavior is locked.
