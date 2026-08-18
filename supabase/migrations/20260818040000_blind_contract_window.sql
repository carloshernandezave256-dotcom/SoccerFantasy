-- Weekly blind contract offers for auction leagues.
create table public.auction_contract_offers (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  add_player_id bigint not null references public.players(id),
  release_player_id bigint not null references public.players(id),
  gameweek integer not null check (gameweek > 0),
  offer_rank integer not null check (offer_rank > 0),
  amount bigint not null check (amount >= 1000000),
  status text not null default 'pending' check (status in ('pending','awarded','unsuccessful','cancelled')),
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  note text,
  check (add_player_id <> release_player_id)
);

create index auction_contract_offers_process_idx
  on public.auction_contract_offers (league_id, gameweek, status, amount desc);
create index auction_contract_offers_user_idx
  on public.auction_contract_offers (user_id, created_at desc);
create unique index auction_contract_offers_pending_player_idx
  on public.auction_contract_offers (league_id, gameweek, user_id, add_player_id)
  where status = 'pending';
create unique index auction_contract_offers_pending_rank_idx
  on public.auction_contract_offers (league_id, gameweek, user_id, offer_rank)
  where status = 'pending';

alter table public.auction_contract_offers enable row level security;
grant select on public.auction_contract_offers to authenticated;
create policy "managers read own contract offers"
on public.auction_contract_offers for select to authenticated
using ((select auth.uid()) = user_id);

create or replace function public.submit_contract_offer(
  p_league_id uuid,
  p_add_player_id bigint,
  p_release_player_id bigint,
  p_amount bigint
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_week integer;
  v_rank integer;
  v_offer uuid;
  v_budget bigint;
begin
  if v_user is null or not private.is_league_member(p_league_id) then
    raise exception 'League membership required';
  end if;
  if not exists(select 1 from public.leagues where id=p_league_id and game_format='auction') then
    raise exception 'Contract offers are only available in auction leagues';
  end if;
  select w.gameweek into v_week
  from public.league_transaction_windows w
  where w.league_id=p_league_id and w.processed_at is null and now()<w.waiver_process_at
  order by w.gameweek desc limit 1;
  if v_week is null then raise exception 'The Blind Contract Window is not open'; end if;
  select remaining_budget into v_budget from public.auction_budgets
  where league_id=p_league_id and user_id=v_user;
  if p_amount < 1000000 then raise exception 'The minimum contract offer is $1M'; end if;
  if p_amount > coalesce(v_budget,0) then raise exception 'That offer exceeds your contract budget'; end if;
  if exists(select 1 from public.draft_picks where league_id=p_league_id and player_id=p_add_player_id) then
    raise exception 'That player is already under contract';
  end if;
  if not exists(select 1 from public.draft_picks where league_id=p_league_id and user_id=v_user and player_id=p_release_player_id) then
    raise exception 'Choose a player under your contract to release';
  end if;
  if not private.player_in_league_pool(p_league_id,p_add_player_id) then
    raise exception 'That player is not eligible for this league';
  end if;
  if not private.roster_is_legal(p_league_id,v_user,array[p_release_player_id],array[p_add_player_id]) then
    raise exception 'That move would break roster limits';
  end if;
  select coalesce(max(offer_rank),0)+1 into v_rank
  from public.auction_contract_offers
  where league_id=p_league_id and gameweek=v_week and user_id=v_user and status='pending';
  insert into public.auction_contract_offers(
    league_id,user_id,add_player_id,release_player_id,gameweek,offer_rank,amount
  ) values (
    p_league_id,v_user,p_add_player_id,p_release_player_id,v_week,v_rank,p_amount
  ) returning id into v_offer;
  return v_offer;
end$$;

create or replace function public.cancel_contract_offer(p_offer_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.auction_contract_offers
  set status='cancelled',processed_at=now(),note='Cancelled by manager'
  where id=p_offer_id and user_id=(select auth.uid()) and status='pending'
    and exists(
      select 1 from public.league_transaction_windows w
      where w.league_id=auction_contract_offers.league_id
        and w.gameweek=auction_contract_offers.gameweek
        and w.processed_at is null and now()<w.waiver_process_at
    );
  if not found then raise exception 'This contract offer can no longer be cancelled'; end if;
end$$;

create or replace function public.reorder_contract_offers(p_league_id uuid,p_offer_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid := (select auth.uid()); v_week integer; v_count integer;
begin
  select gameweek into v_week from public.league_transaction_windows
  where league_id=p_league_id and processed_at is null and now()<waiver_process_at
  order by gameweek desc limit 1;
  if v_week is null then raise exception 'The Blind Contract Window is closed'; end if;
  select count(*) into v_count from public.auction_contract_offers
  where league_id=p_league_id and gameweek=v_week and user_id=v_user and status='pending';
  if v_count<>coalesce(cardinality(p_offer_ids),0) or exists(
    select 1 from unnest(p_offer_ids) x
    left join public.auction_contract_offers o on o.id=x
    where o.id is null or o.league_id<>p_league_id or o.gameweek<>v_week or o.user_id<>v_user or o.status<>'pending'
  ) then raise exception 'Submit every pending contract offer exactly once'; end if;
  update public.auction_contract_offers set offer_rank=-offer_rank
  where league_id=p_league_id and gameweek=v_week and user_id=v_user and status='pending';
  update public.auction_contract_offers o set offer_rank=x.rank
  from unnest(p_offer_ids) with ordinality x(id,rank) where o.id=x.id;
end$$;

create or replace function public.sign_available_player(
  p_league_id uuid,p_add_player_id bigint,p_release_player_id bigint
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  w public.league_transaction_windows%rowtype;
  v_minimum bigint := 1000000;
begin
  if v_user is null or not private.is_league_member(p_league_id) then raise exception 'League membership required'; end if;
  if not exists(select 1 from public.leagues where id=p_league_id and game_format='auction') then raise exception 'Available contracts are only used in auction leagues'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_league_id::text,0));
  select * into w from public.league_transaction_windows where league_id=p_league_id order by gameweek desc limit 1 for update;
  if not found or w.processed_at is null or now()>=w.roster_lock_at then raise exception 'Minimum contracts are not open'; end if;
  if exists(select 1 from public.draft_picks where league_id=p_league_id and player_id=p_add_player_id) then raise exception 'That player is already under contract'; end if;
  if not exists(select 1 from public.draft_picks where league_id=p_league_id and user_id=v_user and player_id=p_release_player_id) then raise exception 'Choose a player under your contract to release'; end if;
  if not private.player_in_league_pool(p_league_id,p_add_player_id) then raise exception 'That player is not eligible for this league'; end if;
  if not private.roster_is_legal(p_league_id,v_user,array[p_release_player_id],array[p_add_player_id]) then raise exception 'That move would break roster limits'; end if;
  update public.auction_budgets set remaining_budget=remaining_budget-v_minimum
  where league_id=p_league_id and user_id=v_user and remaining_budget>=v_minimum;
  if not found then raise exception 'You need at least $1M in contract budget'; end if;
  delete from public.lineup_players where league_id=p_league_id and user_id=v_user and player_id=p_release_player_id;
  update public.draft_picks set player_id=p_add_player_id,picked_at=now(),auto_picked=false,auction_price=v_minimum
  where league_id=p_league_id and user_id=v_user and player_id=p_release_player_id;
end$$;

create or replace function private.process_due_waivers()
returns integer language plpgsql security definer set search_path='' as $$
declare w public.league_transaction_windows%rowtype;c record;v_success integer:=0;v_max integer;v_budget bigint;
begin
  for w in
    select tw.* from public.league_transaction_windows tw
    where tw.processed_at is null and tw.waiver_process_at<=now()
    order by tw.waiver_process_at for update skip locked
  loop
    perform pg_advisory_xact_lock(hashtextextended(w.league_id::text,0));
    update public.league_members m set waiver_priority=r.rank from (
      select user_id,row_number() over(order by random())::integer rank
      from public.league_members where league_id=w.league_id
    ) r where m.league_id=w.league_id and m.user_id=r.user_id;
    update public.league_transaction_windows set priority_randomized_at=now() where id=w.id;

    if exists(select 1 from public.leagues where id=w.league_id and game_format='auction') then
      loop
        select o.* into c
        from public.auction_contract_offers o
        join public.league_members lm on lm.league_id=o.league_id and lm.user_id=o.user_id
        where o.league_id=w.league_id and o.gameweek=w.gameweek and o.status='pending'
        order by o.amount desc,lm.waiver_priority,o.offer_rank,o.created_at
        limit 1 for update of o skip locked;
        exit when not found;
        select remaining_budget into v_budget from public.auction_budgets
        where league_id=w.league_id and user_id=c.user_id for update;
        if exists(select 1 from public.draft_picks where league_id=w.league_id and player_id=c.add_player_id) then
          update public.auction_contract_offers set status='unsuccessful',processed_at=now(),note='Player signed through an earlier offer' where id=c.id;
        elsif coalesce(v_budget,0)<c.amount then
          update public.auction_contract_offers set status='unsuccessful',processed_at=now(),note='Insufficient contract budget when processed' where id=c.id;
        elsif not exists(select 1 from public.draft_picks where league_id=w.league_id and user_id=c.user_id and player_id=c.release_player_id) then
          update public.auction_contract_offers set status='unsuccessful',processed_at=now(),note='Release player is no longer under contract' where id=c.id;
        elsif not private.roster_is_legal(w.league_id,c.user_id,array[c.release_player_id],array[c.add_player_id]) then
          update public.auction_contract_offers set status='unsuccessful',processed_at=now(),note='Roster limits would be exceeded' where id=c.id;
        else
          delete from public.lineup_players where league_id=w.league_id and user_id=c.user_id and player_id=c.release_player_id;
          update public.draft_picks set player_id=c.add_player_id,picked_at=now(),auto_picked=false,auction_price=c.amount
          where league_id=w.league_id and user_id=c.user_id and player_id=c.release_player_id;
          update public.auction_budgets set remaining_budget=remaining_budget-c.amount where league_id=w.league_id and user_id=c.user_id;
          update public.auction_contract_offers set status='awarded',processed_at=now(),note='Contract awarded' where id=c.id;
          update public.auction_contract_offers set status='unsuccessful',processed_at=now(),note='Player signed by another manager'
          where league_id=w.league_id and gameweek=w.gameweek and add_player_id=c.add_player_id and status='pending';
          select coalesce(max(waiver_priority),0)+1 into v_max from public.league_members where league_id=w.league_id;
          update public.league_members set waiver_priority=v_max where league_id=w.league_id and user_id=c.user_id;
          v_success:=v_success+1;
        end if;
      end loop;
    else
      loop
        select wc.* into c from public.waiver_claims wc join public.league_members lm on lm.league_id=wc.league_id and lm.user_id=wc.user_id
        where wc.league_id=w.league_id and wc.gameweek=w.gameweek and wc.status='pending'
        order by lm.waiver_priority,wc.claim_rank,wc.created_at limit 1 for update of wc skip locked;
        exit when not found;
        if exists(select 1 from public.draft_picks where league_id=w.league_id and player_id=c.add_player_id) then
          update public.waiver_claims set status='unsuccessful',processed_at=now(),note='Player was claimed earlier' where id=c.id;
        elsif not exists(select 1 from public.draft_picks where league_id=w.league_id and user_id=c.user_id and player_id=c.drop_player_id) then
          update public.waiver_claims set status='unsuccessful',processed_at=now(),note='Drop player is no longer owned' where id=c.id;
        elsif not private.roster_is_legal(w.league_id,c.user_id,array[c.drop_player_id],array[c.add_player_id]) then
          update public.waiver_claims set status='unsuccessful',processed_at=now(),note='Roster limits would be exceeded' where id=c.id;
        else
          delete from public.lineup_players where league_id=w.league_id and user_id=c.user_id and player_id=c.drop_player_id;
          update public.draft_picks set player_id=c.add_player_id,picked_at=now(),auto_picked=false where league_id=w.league_id and user_id=c.user_id and player_id=c.drop_player_id;
          update public.waiver_claims set status='successful',processed_at=now() where id=c.id;
          select coalesce(max(waiver_priority),0)+1 into v_max from public.league_members where league_id=w.league_id;
          update public.league_members set waiver_priority=v_max where league_id=w.league_id and user_id=c.user_id;
          v_success:=v_success+1;
        end if;
      end loop;
    end if;
    update public.league_transaction_windows set processed_at=now(),updated_at=now() where id=w.id;
  end loop;
  return v_success;
end$$;

revoke all on table public.auction_contract_offers from anon;
revoke all on function public.submit_contract_offer(uuid,bigint,bigint,bigint),public.cancel_contract_offer(uuid),public.reorder_contract_offers(uuid,uuid[]),public.sign_available_player(uuid,bigint,bigint) from public,anon;
grant execute on function public.submit_contract_offer(uuid,bigint,bigint,bigint),public.cancel_contract_offer(uuid),public.reorder_contract_offers(uuid,uuid[]),public.sign_available_player(uuid,bigint,bigint) to authenticated;
revoke all on function private.process_due_waivers() from public,anon,authenticated;

