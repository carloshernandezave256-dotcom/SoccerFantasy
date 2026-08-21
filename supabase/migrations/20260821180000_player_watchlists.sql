create table if not exists public.player_watchlists (
  user_id uuid not null references auth.users(id) on delete cascade,
  league_id uuid not null references public.leagues(id) on delete cascade,
  player_id bigint not null references public.players(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, league_id, player_id)
);

alter table public.player_watchlists enable row level security;

create policy "Managers can read own watchlist" on public.player_watchlists
for select using (auth.uid() = user_id);

create policy "Managers can add to own watchlist" on public.player_watchlists
for insert with check (auth.uid() = user_id);

create policy "Managers can remove from own watchlist" on public.player_watchlists
for delete using (auth.uid() = user_id);

create index if not exists player_watchlists_league_user_idx
on public.player_watchlists (league_id, user_id, created_at desc);
