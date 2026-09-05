-- Close legacy acquisition routes; preserve existing roster and transaction rules.

CREATE OR REPLACE FUNCTION public.pickup_free_agent(p_league_id uuid, p_add_player_id bigint, p_drop_player_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid:=(select auth.uid());w public.league_transaction_windows%rowtype;
begin
  if (select auth.uid()) is null or not private.is_league_member(p_league_id) then raise exception 'League membership required';end if;
  if not exists(select 1 from public.leagues where id=p_league_id and game_format='draft') then raise exception 'This action is only available in draft leagues';end if;
  if v_user is null or not private.is_league_member(p_league_id) then raise exception 'League membership required';end if;
  perform pg_advisory_xact_lock(hashtextextended(p_league_id::text,0));
  select * into w from public.league_transaction_windows where league_id=p_league_id order by gameweek desc limit 1 for update;
  if not found or w.processed_at is null or now()>=coalesce(w.player_market_lock_at,w.roster_lock_at) then raise exception 'Immediate free-agent pickups are not open';end if;
  if exists(select 1 from public.draft_picks where league_id=p_league_id and player_id=p_add_player_id) then raise exception 'That player is already owned';end if;
  if not exists(select 1 from public.draft_picks where league_id=p_league_id and user_id=v_user and player_id=p_drop_player_id) then raise exception 'Choose a player from your roster to drop';end if;
  if not private.roster_is_legal(p_league_id,v_user,array[p_drop_player_id],array[p_add_player_id]) then raise exception 'That move would break roster limits';end if;
  delete from public.lineup_players where league_id=p_league_id and user_id=v_user and player_id=p_drop_player_id;
  update public.draft_picks set player_id=p_add_player_id,picked_at=now(),auto_picked=false where league_id=p_league_id and user_id=v_user and player_id=p_drop_player_id;
end$function$;

CREATE OR REPLACE FUNCTION public.submit_waiver_claim(p_league_id uuid, p_add_player_id bigint, p_drop_player_id bigint)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid:=(select auth.uid());v_claim uuid;v_week integer;v_rank integer;
begin
  if (select auth.uid()) is null or not private.is_league_member(p_league_id) then raise exception 'League membership required';end if;
  if not exists(select 1 from public.leagues where id=p_league_id and game_format='draft') then raise exception 'This action is only available in draft leagues';end if;
  if v_user is null or not private.is_league_member(p_league_id) then raise exception 'League membership required';end if;
  select w.gameweek into v_week from public.league_transaction_windows w
  where w.league_id=p_league_id and now()<w.waiver_process_at order by w.gameweek desc limit 1;
  if v_week is null then raise exception 'Waiver claims are not open';end if;
  if exists(select 1 from public.draft_picks where league_id=p_league_id and player_id=p_add_player_id) then raise exception 'That player is already owned';end if;
  if p_drop_player_id is null or not exists(select 1 from public.draft_picks where league_id=p_league_id and user_id=v_user and player_id=p_drop_player_id) then raise exception 'Choose a player from your roster to drop';end if;
  if not private.roster_is_legal(p_league_id,v_user,array[p_drop_player_id],array[p_add_player_id]) then raise exception 'That move would break the 2 GK, 6 DEF, 5 MID, 5 FWD or four-per-club roster limits';end if;
  select coalesce(max(claim_rank),0)+1 into v_rank from public.waiver_claims where league_id=p_league_id and gameweek=v_week and user_id=v_user and status='pending';
  insert into public.waiver_claims(league_id,user_id,add_player_id,drop_player_id,gameweek,claim_rank)
  values(p_league_id,v_user,p_add_player_id,p_drop_player_id,v_week,v_rank) returning id into v_claim;
  return v_claim;
end$function$;

CREATE OR REPLACE FUNCTION public.make_draft_pick(p_league_id uuid, p_player_id bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := (select auth.uid());
  v_draft public.drafts%rowtype;
  v_n integer;
  v_round integer;
  v_index integer;
  v_slot integer;
  v_on_clock uuid;
  v_pick_id bigint;
  v_player public.players%rowtype;
  v_club_count integer;
begin
  if (select auth.uid()) is null or not private.is_league_member(p_league_id) then raise exception 'League membership required';end if;
  if not exists(select 1 from public.leagues where id=p_league_id and game_format='draft') then raise exception 'This action is only available in draft leagues';end if;
  select * into v_draft from public.drafts where league_id=p_league_id for update;
  if not found or v_draft.status<>'live' then raise exception 'Draft is closed';end if;
  if now()>v_draft.pick_deadline then raise exception 'Pick timer expired';end if;
  select count(*) into v_n from public.league_members where league_id=p_league_id;
  v_round:=((v_draft.current_pick-1)/v_n)+1;
  v_index:=((v_draft.current_pick-1)%v_n)+1;
  v_slot:=case when mod(v_round,2)=1 then v_index else v_n-v_index+1 end;
  select user_id into v_on_clock from public.league_members where league_id=p_league_id and draft_slot=v_slot;
  if v_on_clock<>v_user then raise exception 'It is not your pick';end if;

  select * into v_player from public.players where id=p_player_id and active;
  if not found then raise exception 'That player is unavailable';end if;
  select count(*) into v_club_count
  from public.draft_picks dp join public.players p on p.id=dp.player_id
  where dp.league_id=p_league_id and dp.user_id=v_user and p.club=v_player.club;
  if v_club_count>=4 then raise exception 'You can draft at most 4 players from %',v_player.club;end if;
  if not private.draft_pick_is_valid(p_league_id,v_user,p_player_id) then
    raise exception 'That pick would break the required roster: 2 GK, 6 DEF, 5 MID and 5 FWD';
  end if;

  insert into public.draft_picks(draft_id,league_id,pick_number,round,user_id,player_id)
  values(v_draft.id,p_league_id,v_draft.current_pick,v_round,v_user,p_player_id)
  returning id into v_pick_id;
  update public.drafts set current_pick=current_pick+1,
    status=case when current_pick>=v_n*18 then 'complete'::public.draft_status else status end,
    pick_deadline=case when current_pick>=v_n*18 then null else now()+make_interval(secs=>pick_seconds) end,
    updated_at=now() where id=v_draft.id;
  return v_pick_id;
end
$function$;

CREATE OR REPLACE FUNCTION public.place_auction_bid(p_league_id uuid, p_amount bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid:=(select auth.uid());v_session public.auction_sessions%rowtype;v_lot public.auction_lots%rowtype;v_id bigint;
begin
  if (select auth.uid()) is null or not private.is_league_member(p_league_id) then raise exception 'League membership required';end if;
  if not exists(select 1 from public.leagues where id=p_league_id and game_format='auction') then raise exception 'Auction bidding requires an auction league';end if;
  select * into v_session from public.auction_sessions where league_id=p_league_id for update;
  if not found or v_session.status<>'bidding' or v_session.current_lot_id is null then raise exception 'Bidding is closed';end if;
  select * into v_lot from public.auction_lots where id=v_session.current_lot_id for update;
  if not found or v_lot.status<>'open' or v_lot.league_id<>p_league_id or v_lot.closes_at is null or now()>=v_lot.closes_at then raise exception 'Bid timer expired';end if;
  if not exists(select 1 from public.league_members where league_id=p_league_id and user_id=v_user) then raise exception 'League membership required';end if;
  if not private.draft_pick_is_valid(p_league_id,v_user,v_lot.player_id) then raise exception 'That player would break your roster limits';end if;
  if p_amount is null or p_amount<coalesce(v_lot.current_bid+v_session.bid_increment,v_session.minimum_bid) or mod(p_amount,v_session.bid_increment)<>0 then raise exception 'Bid must beat the leader by at least $1M';end if;
  if p_amount>coalesce(private.auction_max_bid(p_league_id,v_user),0) then raise exception 'That bid would leave too little budget to complete your roster';end if;
  insert into public.auction_bids(league_id,lot_id,user_id,amount) values(p_league_id,v_lot.id,v_user,p_amount) returning id into v_id;
  update public.auction_lots set current_bid=p_amount,current_bidder_id=v_user,
    closes_at=case when closes_at-now()<interval '6 seconds' then now()+interval '6 seconds' else closes_at end where id=v_lot.id;
  update public.auction_sessions set updated_at=now() where id=v_session.id;
  return v_id;
end$function$;

-- Blind offers are the sole auction acquisition route after the auction.
DROP FUNCTION IF EXISTS public.sign_available_player(uuid,bigint,bigint);

-- The scheduled, window-aware private processor is the only settlement route.
CREATE OR REPLACE FUNCTION public.process_waivers(p_league_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'Waivers are processed automatically at the scheduled deadline';
END;
$$;
REVOKE ALL ON FUNCTION public.process_waivers(uuid) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.pickup_free_agent(uuid,bigint,bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_waiver_claim(uuid,bigint,bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.make_draft_pick(uuid,bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.place_auction_bid(uuid,bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pickup_free_agent(uuid,bigint,bigint),
  public.submit_waiver_claim(uuid,bigint,bigint), public.make_draft_pick(uuid,bigint),
  public.place_auction_bid(uuid,bigint) TO authenticated;
