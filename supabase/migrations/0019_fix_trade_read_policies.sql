drop policy if exists "league members read trades" on public.trades;
create policy "league members read trades"
on public.trades
for select
to authenticated
using ((select private.is_league_member(trades.league_id)));

drop policy if exists "league members read trade players" on public.trade_players;
create policy "league members read trade players"
on public.trade_players
for select
to authenticated
using (
  exists (
    select 1
    from public.trades
    where trades.id = trade_players.trade_id
      and (select private.is_league_member(trades.league_id))
  )
);
