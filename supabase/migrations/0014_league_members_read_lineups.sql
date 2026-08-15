drop policy if exists "managers read own lineup" on public.lineup_players;
drop policy if exists "league members read lineups" on public.lineup_players;

create policy "league members read lineups"
on public.lineup_players
for select
to authenticated
using ((select private.is_league_member(lineup_players.league_id)));
