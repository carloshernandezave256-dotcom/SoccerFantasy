alter table public.pack_cards add column if not exists opening_id uuid references public.pack_openings(id) on delete set null;

update public.players set is_club_captain=true where full_name in('Martin Ødegaard','Virgil van Dijk','Bruno Fernandes','Lautaro Martínez','Marquinhos');

create table if not exists public.pack_auction_listings(
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  seller_id uuid not null references public.profiles(id) on delete cascade,
  card_id uuid not null unique references public.pack_cards(id) on delete cascade,
  starting_price integer not null check(starting_price>=50),
  buy_now_price integer check(buy_now_price is null or buy_now_price>=starting_price),
  current_price integer not null check(current_price>=50),
  current_bidder_id uuid references public.profiles(id),
  status text not null default 'active' check(status in('active','sold','expired','cancelled')),
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key(league_id,seller_id) references public.league_members(league_id,user_id) on delete cascade
);
create index if not exists pack_auction_active_idx on public.pack_auction_listings(league_id,status,ends_at);

create table if not exists public.pack_auction_bids(
  id bigint generated always as identity primary key,
  listing_id uuid not null references public.pack_auction_listings(id) on delete cascade,
  bidder_id uuid not null references public.profiles(id) on delete cascade,
  amount integer not null check(amount>=50),
  created_at timestamptz not null default now()
);

alter table public.pack_auction_listings enable row level security;
alter table public.pack_auction_bids enable row level security;
revoke all on public.pack_auction_listings,public.pack_auction_bids from anon,authenticated;
grant select on public.pack_auction_listings,public.pack_auction_bids to authenticated;
create policy "members read league auctions" on public.pack_auction_listings for select to authenticated
using(exists(select 1 from public.league_members m where m.league_id=pack_auction_listings.league_id and m.user_id=(select auth.uid())));
create policy "members read league bids" on public.pack_auction_bids for select to authenticated
using(exists(select 1 from public.pack_auction_listings l join public.league_members m on m.league_id=l.league_id where l.id=pack_auction_bids.listing_id and m.user_id=(select auth.uid())));

create or replace function public.claim_pack_starter(p_league_id uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_open uuid;v_ids bigint[]:='{}';v_id bigint;v_pos public.player_position;v_need int;
begin
  if not exists(select 1 from public.league_members m join public.leagues l on l.id=m.league_id where m.league_id=p_league_id and m.user_id=v_user and l.game_format='pack') then raise exception 'Pack League membership required';end if;
  if exists(select 1 from public.pack_cards where league_id=p_league_id and user_id=v_user) then raise exception 'Starter bundle already claimed';end if;
  insert into public.pack_openings(league_id,user_id,pack_type) values(p_league_id,v_user,'starter') returning id into v_open;
  select id into v_id from public.players where active and is_club_captain order by random() limit 1;
  if v_id is null then raise exception 'Captain pool is not ready';end if;
  insert into public.pack_cards(league_id,user_id,player_id,acquired_via,opening_id) values(p_league_id,v_user,v_id,'starter_captain',v_open);v_ids:=array_append(v_ids,v_id);
  select id into v_id from public.players where active and draft_rank<=50 and not(id=any(v_ids)) order by random() limit 1;
  insert into public.pack_cards(league_id,user_id,player_id,acquired_via,opening_id) values(p_league_id,v_user,v_id,'starter_superstar',v_open);v_ids:=array_append(v_ids,v_id);
  foreach v_pos in array array['GK','DEF','MID','FWD']::public.player_position[] loop
    v_need:=case v_pos when 'GK' then 2 when 'DEF' then 6 when 'MID' then 6 else 4 end;
    for v_id in select id from public.players where active and position=v_pos and not(id=any(v_ids)) order by random() limit v_need loop
      insert into public.pack_cards(league_id,user_id,player_id,acquired_via,opening_id) values(p_league_id,v_user,v_id,'starter_regular',v_open);v_ids:=array_append(v_ids,v_id);
    end loop;
  end loop;
  while cardinality(v_ids)<22 loop
    select id into v_id from public.players where active and not(id=any(v_ids)) order by random() limit 1;
    insert into public.pack_cards(league_id,user_id,player_id,acquired_via,opening_id) values(p_league_id,v_user,v_id,'starter_regular',v_open);v_ids:=array_append(v_ids,v_id);
  end loop;
  update public.pack_wallets set coins=500,updated_at=now() where league_id=p_league_id and user_id=v_user;
  return cardinality(v_ids);
end$$;

create or replace function public.open_pack(p_league_id uuid,p_pack_type text) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_cost int;v_count int;v_open uuid;v_id bigint;v_pos public.player_position;v_super boolean:=false;v_existing int;
begin
  if p_pack_type not in('regular','position_gk','position_def','position_mid','position_fwd','captain','superstar') then raise exception 'Invalid pack type';end if;
  if not exists(select 1 from public.league_members m join public.leagues l on l.id=m.league_id where m.league_id=p_league_id and m.user_id=v_user and l.game_format='pack') then raise exception 'Pack League membership required';end if;
  v_cost:=case when p_pack_type='regular' then 500 when p_pack_type like 'position_%' then 750 when p_pack_type='captain' then 1000 else 1500 end;
  v_count:=case when p_pack_type='regular' then 5 when p_pack_type like 'position_%' then 3 else 1 end;
  select count(*) into v_existing from public.pack_cards where league_id=p_league_id and user_id=v_user;
  if v_existing+v_count>50 then raise exception 'Not enough collection space';end if;
  update public.pack_wallets set coins=coins-v_cost,updated_at=now() where league_id=p_league_id and user_id=v_user and coins>=v_cost;
  if not found then raise exception 'Not enough coins';end if;
  insert into public.pack_openings(league_id,user_id,pack_type,coin_cost) values(p_league_id,v_user,p_pack_type,v_cost) returning id into v_open;
  if p_pack_type='regular' then v_super:=random()<0.05;end if;
  for i in 1..v_count loop
    v_pos:=case p_pack_type when 'position_gk' then 'GK'::public.player_position when 'position_def' then 'DEF'::public.player_position when 'position_mid' then 'MID'::public.player_position when 'position_fwd' then 'FWD'::public.player_position else null end;
    select id into v_id from public.players where active and (v_pos is null or position=v_pos)
      and (p_pack_type<>'captain' or is_club_captain)
      and (p_pack_type<>'superstar' or draft_rank<=50)
      and (p_pack_type<>'regular' or (case when v_super and i=1 then draft_rank<=50 else draft_rank>50 or draft_rank is null end))
      order by random() limit 1;
    insert into public.pack_cards(league_id,user_id,player_id,acquired_via,opening_id) values(p_league_id,v_user,v_id,
      case when p_pack_type='regular' then 'regular_pack' when p_pack_type like 'position_%' then 'position_pack' when p_pack_type='captain' then 'captain_pack' else 'superstar_pack' end,v_open);
  end loop;
  return v_open;
end$$;

create or replace function public.exchange_duplicate(p_card_id uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_card public.pack_cards%rowtype;v_count int;
begin
  select * into v_card from public.pack_cards where id=p_card_id and user_id=v_user for update;if not found then raise exception 'Card not found';end if;
  if v_card.active_slot is not null then raise exception 'Remove this card from the active squad first';end if;
  select count(*) into v_count from public.pack_cards where league_id=v_card.league_id and user_id=v_user and player_id=v_card.player_id;
  if v_count<2 then raise exception 'Only duplicate cards can be exchanged';end if;
  if exists(select 1 from public.pack_auction_listings where card_id=p_card_id and status='active') then raise exception 'Card is listed in the auction house';end if;
  delete from public.pack_cards where id=p_card_id;update public.pack_wallets set pack_tokens=pack_tokens+1,updated_at=now() where league_id=v_card.league_id and user_id=v_user;
  return 1;
end$$;

create or replace function public.set_pack_active_squad(p_league_id uuid,p_card_ids uuid[]) returns integer
language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_owned int;v_unique int;
begin
  if cardinality(p_card_ids)>18 then raise exception 'Active squad is limited to 18 cards';end if;
  select count(*),count(distinct player_id) into v_owned,v_unique from public.pack_cards where league_id=p_league_id and user_id=v_user and id=any(p_card_ids);
  if v_owned<>cardinality(p_card_ids) then raise exception 'One or more cards are not yours';end if;if v_unique<>v_owned then raise exception 'Only one copy of a player can be active';end if;
  update public.pack_cards set active_slot=null where league_id=p_league_id and user_id=v_user;
  update public.pack_cards c set active_slot=x.ord from unnest(p_card_ids) with ordinality x(id,ord) where c.id=x.id and c.user_id=v_user;
  return v_owned;
end$$;

create or replace function public.create_pack_listing(p_card_id uuid,p_starting_price integer,p_buy_now_price integer,p_duration_hours integer) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_card public.pack_cards%rowtype;v_count int;v_id uuid;
begin
  if p_duration_hours not in(12,24,48) then raise exception 'Choose 12, 24, or 48 hours';end if;
  select * into v_card from public.pack_cards where id=p_card_id and user_id=v_user for update;if not found then raise exception 'Card not found';end if;
  if v_card.active_slot is not null then raise exception 'Remove this card from the active squad first';end if;
  select count(*) into v_count from public.pack_cards where league_id=v_card.league_id and user_id=v_user and player_id=v_card.player_id;
  if v_count<2 then raise exception 'Only duplicate cards can be listed';end if;
  insert into public.pack_auction_listings(league_id,seller_id,card_id,starting_price,buy_now_price,current_price,ends_at) values(v_card.league_id,v_user,p_card_id,p_starting_price,p_buy_now_price,p_starting_price,now()+make_interval(hours=>p_duration_hours)) returning id into v_id;return v_id;
end$$;

create or replace function public.bid_pack_listing(p_listing_id uuid,p_amount integer) returns integer
language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_l public.pack_auction_listings%rowtype;v_space int;
begin
  select * into v_l from public.pack_auction_listings where id=p_listing_id for update;if not found or v_l.status<>'active' or v_l.ends_at<=now() then raise exception 'Listing is not active';end if;
  if v_l.seller_id=v_user then raise exception 'You cannot bid on your own card';end if;if p_amount<=v_l.current_price then raise exception 'Bid must beat the current price';end if;
  select count(*) into v_space from public.pack_cards where league_id=v_l.league_id and user_id=v_user;if v_space>=50 then raise exception 'Your collection is full';end if;
  update public.pack_wallets set coins=coins-p_amount,updated_at=now() where league_id=v_l.league_id and user_id=v_user and coins>=p_amount;if not found then raise exception 'Not enough coins';end if;
  if v_l.current_bidder_id is not null then update public.pack_wallets set coins=coins+v_l.current_price,updated_at=now() where league_id=v_l.league_id and user_id=v_l.current_bidder_id;end if;
  insert into public.pack_auction_bids(listing_id,bidder_id,amount) values(p_listing_id,v_user,p_amount);update public.pack_auction_listings set current_price=p_amount,current_bidder_id=v_user where id=p_listing_id;return p_amount;
end$$;

create or replace function public.buy_pack_listing(p_listing_id uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_l public.pack_auction_listings%rowtype;v_space int;v_net int;
begin
  select * into v_l from public.pack_auction_listings where id=p_listing_id for update;if not found or v_l.status<>'active' or v_l.ends_at<=now() or v_l.buy_now_price is null then raise exception 'Buy now is not available';end if;
  if v_l.seller_id=v_user then raise exception 'You cannot buy your own card';end if;select count(*) into v_space from public.pack_cards where league_id=v_l.league_id and user_id=v_user;if v_space>=50 then raise exception 'Your collection is full';end if;
  update public.pack_wallets set coins=coins-v_l.buy_now_price,updated_at=now() where league_id=v_l.league_id and user_id=v_user and coins>=v_l.buy_now_price;if not found then raise exception 'Not enough coins';end if;
  if v_l.current_bidder_id is not null then update public.pack_wallets set coins=coins+v_l.current_price where league_id=v_l.league_id and user_id=v_l.current_bidder_id;end if;
  v_net:=floor(v_l.buy_now_price*0.95);update public.pack_wallets set coins=coins+v_net where league_id=v_l.league_id and user_id=v_l.seller_id;
  update public.pack_cards set user_id=v_user,acquired_via='auction',active_slot=null where id=v_l.card_id;update public.pack_auction_listings set status='sold',current_price=v_l.buy_now_price,current_bidder_id=v_user where id=p_listing_id;return v_l.buy_now_price;
end$$;

revoke all on function public.claim_pack_starter(uuid),public.open_pack(uuid,text),public.exchange_duplicate(uuid),public.set_pack_active_squad(uuid,uuid[]),public.create_pack_listing(uuid,integer,integer,integer),public.bid_pack_listing(uuid,integer),public.buy_pack_listing(uuid) from public,anon;
grant execute on function public.claim_pack_starter(uuid),public.open_pack(uuid,text),public.exchange_duplicate(uuid),public.set_pack_active_squad(uuid,uuid[]),public.create_pack_listing(uuid,integer,integer,integer),public.bid_pack_listing(uuid,integer),public.buy_pack_listing(uuid) to authenticated;
