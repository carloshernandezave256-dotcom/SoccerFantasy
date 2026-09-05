-- Share the same league transaction mutex as pickups and waiver settlement.
-- Read the routing key first; acquire the mutex before taking any trade row lock.
create or replace function public.respond_to_trade(p_trade_id uuid,p_accept boolean)
returns public.trade_status language plpgsql security definer set search_path='' as $$
declare
 v_user uuid:=(select auth.uid());v_league uuid;v_trade public.trades%rowtype;
 v_format text;v_enabled boolean;v_members integer;v_expected integer;v_owned integer;v_moved integer;
 v_offered bigint[];v_requested bigint[];v_cutoff timestamptz;
begin
 if v_user is null then raise exception 'Sign in is required';end if;
 if p_accept is null then raise exception 'Choose accept or decline';end if;
 select league_id into v_league from public.trades where id=p_trade_id and recipient_id=v_user;
 if not found then raise exception 'Trade not found or not addressed to you';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_league::text,0));
 select * into v_trade from public.trades where id=p_trade_id for update;
 if not found or v_trade.league_id<>v_league or v_trade.recipient_id<>v_user then raise exception 'Trade changed; reload and try again';end if;
 if v_trade.status<>'pending' then raise exception 'This trade is no longer pending';end if;
 if v_trade.expires_at<=clock_timestamp() then
   update public.trades set status='expired',responded_at=clock_timestamp() where id=p_trade_id;return 'expired';
 end if;
 if not p_accept then
   update public.trades set status='declined',responded_at=clock_timestamp(),seen_at=coalesce(seen_at,clock_timestamp()) where id=p_trade_id;return 'declined';
 end if;
 select game_format,trades_enabled into v_format,v_enabled from public.leagues where id=v_league for share;
 if not found or not coalesce(v_enabled,false) then raise exception 'Trades are disabled in this league';end if;
 perform 1 from public.league_members where league_id=v_league and user_id in(v_trade.proposer_id,v_trade.recipient_id) order by user_id for share;
 select count(distinct user_id) into v_members from public.league_members where league_id=v_league and user_id in(v_trade.proposer_id,v_trade.recipient_id);
 if v_members<>2 then raise exception 'Both managers must still belong to this league';end if;
 select roster_lock_at into v_cutoff from public.league_transaction_windows where league_id=v_league order by gameweek desc limit 1 for share;
 -- Recheck the actual clock after waiting for transaction/ownership locks.
 perform 1 from public.trade_players where trade_id=p_trade_id order by player_id for update;
 select array_agg(player_id) filter(where from_user_id=v_trade.proposer_id),
   array_agg(player_id) filter(where from_user_id=v_trade.recipient_id),count(*)
 into v_offered,v_requested,v_expected from public.trade_players where trade_id=p_trade_id;
 if coalesce(cardinality(v_offered),0)=0 or coalesce(cardinality(v_requested),0)=0
   or exists(select 1 from public.trade_players where trade_id=p_trade_id and from_user_id not in(v_trade.proposer_id,v_trade.recipient_id))
 then raise exception 'Trade must contain players from both managers';end if;
 if v_format='pack' then
   perform 1 from public.pack_cards where league_id=v_league and user_id in(v_trade.proposer_id,v_trade.recipient_id) order by id for update;
   select count(*) into v_owned from public.trade_players tp join public.pack_cards pc
     on pc.id=tp.pack_card_id and pc.player_id=tp.player_id and pc.league_id=v_league and pc.user_id=tp.from_user_id where tp.trade_id=p_trade_id;
 else
   perform 1 from public.draft_picks where league_id=v_league and user_id in(v_trade.proposer_id,v_trade.recipient_id) order by id for update;
   select count(*) into v_owned from public.trade_players tp join public.draft_picks dp
     on dp.league_id=v_league and dp.player_id=tp.player_id and dp.user_id=tp.from_user_id where tp.trade_id=p_trade_id;
 end if;
 if v_owned<>v_expected then raise exception 'Player ownership changed; this trade is invalid';end if;
 if v_format<>'pack' and (not private.trade_roster_is_legal(v_league,v_trade.proposer_id,v_offered,v_requested)
   or not private.trade_roster_is_legal(v_league,v_trade.recipient_id,v_requested,v_offered))
 then raise exception 'This trade would break roster position or four-per-club limits';end if;
 if v_cutoff is not null and clock_timestamp()>=v_cutoff then raise exception 'Trading is locked because this matchweek has started';end if;
 if v_trade.expires_at<=clock_timestamp() then
   update public.trades set status='expired',responded_at=clock_timestamp() where id=p_trade_id;return 'expired';
 end if;
 if v_format='pack' then
   delete from public.lineup_players lp using public.trade_players tp,public.pack_cards pc
   where tp.trade_id=p_trade_id and pc.id=tp.pack_card_id and pc.active_slot is not null
     and lp.league_id=v_league and lp.user_id=tp.from_user_id and lp.player_id=tp.player_id;
   update public.pack_cards pc set user_id=case when tp.from_user_id=v_trade.proposer_id then v_trade.recipient_id else v_trade.proposer_id end,
     active_slot=null,acquired_via='trade'
   from public.trade_players tp where tp.trade_id=p_trade_id and pc.id=tp.pack_card_id and pc.league_id=v_league and pc.user_id=tp.from_user_id;
 else
   delete from public.lineup_players lp using public.trade_players tp
   where tp.trade_id=p_trade_id and lp.league_id=v_league and lp.user_id=tp.from_user_id and lp.player_id=tp.player_id;
   update public.draft_picks dp set user_id=case when tp.from_user_id=v_trade.proposer_id then v_trade.recipient_id else v_trade.proposer_id end
   from public.trade_players tp where tp.trade_id=p_trade_id and dp.league_id=v_league and dp.player_id=tp.player_id and dp.user_id=tp.from_user_id;
 end if;
 get diagnostics v_moved=row_count;
 if v_moved<>v_expected then raise exception 'Trade ownership update incomplete; no players were moved';end if;
 update public.trades set status='accepted',responded_at=clock_timestamp(),seen_at=coalesce(seen_at,clock_timestamp()) where id=p_trade_id;
 update public.trades other set status='cancelled',responded_at=clock_timestamp()
 where other.league_id=v_league and other.status='pending' and other.id<>p_trade_id
   and exists(select 1 from public.trade_players x join public.trade_players moved
     on (v_format='pack' and x.pack_card_id=moved.pack_card_id) or (v_format<>'pack' and x.player_id=moved.player_id)
     where x.trade_id=other.id and moved.trade_id=p_trade_id);
 return 'accepted';
end;$$;
revoke all on function public.respond_to_trade(uuid,boolean) from public,anon;
grant execute on function public.respond_to_trade(uuid,boolean) to authenticated;
