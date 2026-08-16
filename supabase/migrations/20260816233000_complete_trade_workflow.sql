alter type public.trade_status add value if not exists 'expired';

alter table public.trades
  add column if not exists seen_at timestamptz,
  add column if not exists expires_at timestamptz not null default (now() + interval '48 hours'),
  add column if not exists counter_of uuid references public.trades(id) on delete set null;

alter table public.trade_players
  add column if not exists pack_card_id uuid references public.pack_cards(id) on delete cascade;

create index if not exists trades_unread_recipient_idx
  on public.trades(recipient_id,league_id,created_at desc)
  where status='pending' and seen_at is null;

create or replace function private.trade_window_is_open(p_league_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce((
    select now() < w.roster_lock_at
    from public.league_transaction_windows w
    where w.league_id=p_league_id
    order by w.gameweek desc limit 1
  ),true)
$$;

create or replace function private.trade_roster_is_legal(
  p_league_id uuid,p_user_id uuid,p_remove bigint[],p_add bigint[]
) returns boolean language sql stable security definer set search_path='' as $$
  with projected as (
    select dp.player_id from public.draft_picks dp
    where dp.league_id=p_league_id and dp.user_id=p_user_id
      and not(dp.player_id=any(coalesce(p_remove,'{}'::bigint[])))
    union all select unnest(coalesce(p_add,'{}'::bigint[]))
  ), position_counts as (
    select count(*) total,
      count(*) filter(where p.position='GK') gk,
      count(*) filter(where p.position='DEF') def,
      count(*) filter(where p.position='MID') mid,
      count(*) filter(where p.position='FWD') fwd
    from projected r join public.players p on p.id=r.player_id
  ), club_counts as (
    select coalesce(max(c),0) max_club from (
      select count(*) c from projected r join public.players p on p.id=r.player_id group by p.club
    ) clubs
  )
  select case when pc.total<18 then cc.max_club<=4
    else pc.total=18 and pc.gk=2 and pc.def=6 and pc.mid=5 and pc.fwd=5 and cc.max_club<=4 end
  from position_counts pc cross join club_counts cc
$$;

create or replace function private.insert_trade_offer(
  p_league_id uuid,p_user uuid,p_recipient_id uuid,p_offered bigint[],p_requested bigint[],p_note text,p_counter_of uuid default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_trade uuid;v_count integer;v_deadline timestamptz;
begin
  if p_user is null then raise exception 'Authentication required';end if;
  if not coalesce((select trades_enabled from public.leagues where id=p_league_id),false) then raise exception 'Trading is disabled in this league';end if;
  if not private.trade_window_is_open(p_league_id) then raise exception 'Trading is locked because this matchweek has started';end if;
  if p_recipient_id=p_user then raise exception 'Choose another manager';end if;
  if cardinality(p_offered)<1 or cardinality(p_requested)<1 then raise exception 'Select at least one player from each team';end if;
  if cardinality(p_offered)<>cardinality(p_requested) then raise exception 'Trades must exchange equal numbers of players';end if;
  if cardinality(p_offered)<>cardinality(array(select distinct unnest(p_offered))) or cardinality(p_requested)<>cardinality(array(select distinct unnest(p_requested))) then raise exception 'Duplicate players are not allowed';end if;
  if p_offered&&p_requested then raise exception 'A player cannot appear on both sides';end if;
  if not private.is_league_member(p_league_id) or not exists(select 1 from public.league_members where league_id=p_league_id and user_id=p_recipient_id) then raise exception 'Both managers must belong to this league';end if;
  select count(*) into v_count from public.draft_picks where league_id=p_league_id and user_id=p_user and player_id=any(p_offered);
  if v_count<>cardinality(p_offered) then raise exception 'You no longer own every offered player';end if;
  select count(*) into v_count from public.draft_picks where league_id=p_league_id and user_id=p_recipient_id and player_id=any(p_requested);
  if v_count<>cardinality(p_requested) then raise exception 'The other manager no longer owns every requested player';end if;
  if not private.trade_roster_is_legal(p_league_id,p_user,p_offered,p_requested) or not private.trade_roster_is_legal(p_league_id,p_recipient_id,p_requested,p_offered) then
    raise exception 'This trade would break roster position or four-per-club limits';
  end if;
  if p_counter_of is not null and not exists(select 1 from public.trades where id=p_counter_of and league_id=p_league_id and recipient_id=p_user) then raise exception 'The original offer cannot be countered';end if;
  select least(now()+interval '48 hours',coalesce((select roster_lock_at from public.league_transaction_windows where league_id=p_league_id and roster_lock_at>now() order by gameweek desc limit 1),now()+interval '48 hours')) into v_deadline;
  insert into public.trades(league_id,proposer_id,recipient_id,note,expires_at,counter_of)
  values(p_league_id,p_user,p_recipient_id,nullif(trim(p_note),''),v_deadline,p_counter_of) returning id into v_trade;
  insert into public.trade_players(trade_id,player_id,from_user_id) select v_trade,x,p_user from unnest(p_offered)x;
  insert into public.trade_players(trade_id,player_id,from_user_id) select v_trade,x,p_recipient_id from unnest(p_requested)x;
  if p_counter_of is not null then update public.trades set status='declined',responded_at=now() where id=p_counter_of and status='pending';end if;
  return v_trade;
end$$;

create or replace function public.create_trade_offer(p_league_id uuid,p_recipient_id uuid,p_offered bigint[],p_requested bigint[],p_note text default null)
returns uuid language sql security definer set search_path='' as $$
  select private.insert_trade_offer(p_league_id,(select auth.uid()),p_recipient_id,p_offered,p_requested,p_note,null)
$$;

create or replace function public.create_trade_counter(p_trade_id uuid,p_offered bigint[],p_requested bigint[],p_note text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_original public.trades%rowtype;
begin
  select * into v_original from public.trades where id=p_trade_id and status='pending' and expires_at>now() for update;
  if not found then raise exception 'This offer is no longer available to counter';end if;
  if v_original.recipient_id<>(select auth.uid()) then raise exception 'Only the recipient can counter';end if;
  return private.insert_trade_offer(v_original.league_id,(select auth.uid()),v_original.proposer_id,p_offered,p_requested,p_note,p_trade_id);
end$$;

create or replace function private.insert_pack_trade_offer(
  p_league_id uuid,p_user uuid,p_recipient_id uuid,p_offered_cards uuid[],p_requested_cards uuid[],p_note text,p_counter_of uuid default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_trade uuid;v_count integer;v_deadline timestamptz;
begin
  if p_user is null then raise exception 'Authentication required';end if;
  if not coalesce((select trades_enabled from public.leagues where id=p_league_id and game_format='pack'),false) then raise exception 'Pack trading is disabled in this league';end if;
  if not private.trade_window_is_open(p_league_id) then raise exception 'Trading is locked because this matchweek has started';end if;
  if p_recipient_id=p_user then raise exception 'Choose another manager';end if;
  if cardinality(p_offered_cards)<1 or cardinality(p_offered_cards)<>cardinality(p_requested_cards) then raise exception 'Select the same number of cards from each collection';end if;
  if cardinality(p_offered_cards)<>cardinality(array(select distinct unnest(p_offered_cards))) or cardinality(p_requested_cards)<>cardinality(array(select distinct unnest(p_requested_cards))) then raise exception 'A card can only appear once';end if;
  if not private.is_league_member(p_league_id) or not exists(select 1 from public.league_members where league_id=p_league_id and user_id=p_recipient_id) then raise exception 'Both managers must belong to this league';end if;
  select count(*) into v_count from public.pack_cards where league_id=p_league_id and user_id=p_user and id=any(p_offered_cards);
  if v_count<>cardinality(p_offered_cards) then raise exception 'You no longer own every offered card';end if;
  select count(*) into v_count from public.pack_cards where league_id=p_league_id and user_id=p_recipient_id and id=any(p_requested_cards);
  if v_count<>cardinality(p_requested_cards) then raise exception 'The other manager no longer owns every requested card';end if;
  if p_counter_of is not null and not exists(select 1 from public.trades where id=p_counter_of and league_id=p_league_id and recipient_id=p_user) then raise exception 'The original offer cannot be countered';end if;
  select least(now()+interval '48 hours',coalesce((select roster_lock_at from public.league_transaction_windows where league_id=p_league_id and roster_lock_at>now() order by gameweek desc limit 1),now()+interval '48 hours')) into v_deadline;
  insert into public.trades(league_id,proposer_id,recipient_id,note,expires_at,counter_of)
  values(p_league_id,p_user,p_recipient_id,nullif(trim(p_note),''),v_deadline,p_counter_of) returning id into v_trade;
  insert into public.trade_players(trade_id,player_id,pack_card_id,from_user_id)
    select v_trade,c.player_id,c.id,p_user from public.pack_cards c where c.id=any(p_offered_cards);
  insert into public.trade_players(trade_id,player_id,pack_card_id,from_user_id)
    select v_trade,c.player_id,c.id,p_recipient_id from public.pack_cards c where c.id=any(p_requested_cards);
  if p_counter_of is not null then update public.trades set status='declined',responded_at=now() where id=p_counter_of and status='pending';end if;
  return v_trade;
end$$;

create or replace function public.create_pack_trade_offer(p_league_id uuid,p_recipient_id uuid,p_offered_cards uuid[],p_requested_cards uuid[],p_note text default null)
returns uuid language sql security definer set search_path='' as $$
  select private.insert_pack_trade_offer(p_league_id,(select auth.uid()),p_recipient_id,p_offered_cards,p_requested_cards,p_note,null)
$$;

create or replace function public.create_pack_trade_counter(p_trade_id uuid,p_offered_cards uuid[],p_requested_cards uuid[],p_note text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_original public.trades%rowtype;
begin
  select * into v_original from public.trades where id=p_trade_id and status='pending' and expires_at>now() for update;
  if not found then raise exception 'This offer is no longer available to counter';end if;
  if v_original.recipient_id<>(select auth.uid()) then raise exception 'Only the recipient can counter';end if;
  return private.insert_pack_trade_offer(v_original.league_id,(select auth.uid()),v_original.proposer_id,p_offered_cards,p_requested_cards,p_note,p_trade_id);
end$$;

create or replace function public.respond_to_trade(p_trade_id uuid,p_accept boolean)
returns public.trade_status language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_trade public.trades%rowtype;v_expected integer;v_owned integer;v_offered bigint[];v_requested bigint[];v_cards uuid[];v_format text;
begin
  select * into v_trade from public.trades where id=p_trade_id for update;
  if not found then raise exception 'Trade not found';end if;
  if v_trade.recipient_id<>v_user then raise exception 'Only the recipient can respond';end if;
  if v_trade.status<>'pending' then raise exception 'This trade is no longer pending';end if;
  if v_trade.expires_at<=now() then update public.trades set status='expired',responded_at=now() where id=p_trade_id;return 'expired';end if;
  if not p_accept then update public.trades set status='declined',responded_at=now(),seen_at=coalesce(seen_at,now()) where id=p_trade_id;return 'declined';end if;
  if not private.trade_window_is_open(v_trade.league_id) then raise exception 'Trading is locked because this matchweek has started';end if;
  select game_format into v_format from public.leagues where id=v_trade.league_id;
  select array_agg(player_id) filter(where from_user_id=v_trade.proposer_id),array_agg(player_id) filter(where from_user_id=v_trade.recipient_id)
  into v_offered,v_requested from public.trade_players where trade_id=p_trade_id;
  select count(*) into v_expected from public.trade_players where trade_id=p_trade_id;
  if v_format='pack' then
    select count(*) into v_owned from public.trade_players tp join public.pack_cards pc on pc.id=tp.pack_card_id and pc.league_id=v_trade.league_id and pc.user_id=tp.from_user_id where tp.trade_id=p_trade_id;
  else
    if not private.trade_roster_is_legal(v_trade.league_id,v_trade.proposer_id,v_offered,v_requested) or not private.trade_roster_is_legal(v_trade.league_id,v_trade.recipient_id,v_requested,v_offered) then raise exception 'This trade would break roster position or four-per-club limits';end if;
    select count(*) into v_owned from public.trade_players tp join public.draft_picks dp on dp.league_id=v_trade.league_id and dp.player_id=tp.player_id and dp.user_id=tp.from_user_id where tp.trade_id=p_trade_id;
  end if;
  if v_owned<>v_expected then raise exception 'Player ownership changed; this trade is invalid';end if;
  delete from public.lineup_players where league_id=v_trade.league_id and player_id=any(v_offered||v_requested);
  if v_format='pack' then
    select array_agg(pack_card_id) into v_cards from public.trade_players where trade_id=p_trade_id;
    update public.pack_cards pc set user_id=case when tp.from_user_id=v_trade.proposer_id then v_trade.recipient_id else v_trade.proposer_id end,active_slot=null,acquired_via='trade'
    from public.trade_players tp where tp.trade_id=p_trade_id and pc.id=tp.pack_card_id and pc.user_id=tp.from_user_id;
  else
    update public.draft_picks dp set user_id=case when tp.from_user_id=v_trade.proposer_id then v_trade.recipient_id else v_trade.proposer_id end
    from public.trade_players tp where tp.trade_id=p_trade_id and dp.league_id=v_trade.league_id and dp.player_id=tp.player_id and dp.user_id=tp.from_user_id;
  end if;
  update public.trades set status='accepted',responded_at=now(),seen_at=coalesce(seen_at,now()) where id=p_trade_id;
  update public.trades set status='cancelled',responded_at=now() where league_id=v_trade.league_id and status='pending' and id<>p_trade_id and exists(select 1 from public.trade_players x where x.trade_id=trades.id and x.player_id=any(v_offered||v_requested));
  return 'accepted';
end$$;

create or replace function public.unread_trade_count(p_league_id uuid)
returns integer language sql stable security invoker set search_path='' as $$
  select count(*)::integer from public.trades
  where league_id=p_league_id and recipient_id=(select auth.uid()) and status='pending' and expires_at>now() and seen_at is null
$$;

create or replace function public.mark_trade_offers_seen(p_league_id uuid)
returns void language sql security definer set search_path='' as $$
  update public.trades set seen_at=now()
  where league_id=p_league_id and recipient_id=(select auth.uid()) and status='pending' and seen_at is null
$$;

revoke all on function private.trade_window_is_open(uuid) from public,anon,authenticated;
revoke all on function private.trade_roster_is_legal(uuid,uuid,bigint[],bigint[]) from public,anon,authenticated;
revoke all on function private.insert_trade_offer(uuid,uuid,uuid,bigint[],bigint[],text,uuid) from public,anon,authenticated;
revoke all on function private.insert_pack_trade_offer(uuid,uuid,uuid,uuid[],uuid[],text,uuid) from public,anon,authenticated;
revoke all on function public.create_trade_counter(uuid,bigint[],bigint[],text) from public,anon;
revoke all on function public.create_pack_trade_offer(uuid,uuid,uuid[],uuid[],text) from public,anon;
revoke all on function public.create_pack_trade_counter(uuid,uuid[],uuid[],text) from public,anon;
revoke all on function public.unread_trade_count(uuid) from public,anon;
revoke all on function public.mark_trade_offers_seen(uuid) from public,anon;
grant execute on function public.create_trade_counter(uuid,bigint[],bigint[],text) to authenticated;
grant execute on function public.create_pack_trade_offer(uuid,uuid,uuid[],uuid[],text) to authenticated;
grant execute on function public.create_pack_trade_counter(uuid,uuid[],uuid[],text) to authenticated;
grant execute on function public.unread_trade_count(uuid) to authenticated;
grant execute on function public.mark_trade_offers_seen(uuid) to authenticated;
