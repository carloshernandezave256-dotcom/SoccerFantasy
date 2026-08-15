drop policy if exists "members read league pack wallets" on public.pack_wallets;
create policy "members read league pack wallets" on public.pack_wallets
for select to authenticated using ((select private.is_league_member(pack_wallets.league_id)));

drop policy if exists "members read league collections" on public.pack_cards;
create policy "members read league collections" on public.pack_cards
for select to authenticated using ((select private.is_league_member(pack_cards.league_id)));

drop policy if exists "members read league auctions" on public.pack_auction_listings;
create policy "members read league auctions" on public.pack_auction_listings
for select to authenticated using ((select private.is_league_member(pack_auction_listings.league_id)));

drop policy if exists "members read league bids" on public.pack_auction_bids;
create policy "members read league bids" on public.pack_auction_bids
for select to authenticated using (exists(
  select 1 from public.pack_auction_listings l
  where l.id=pack_auction_bids.listing_id and (select private.is_league_member(l.league_id))
));
