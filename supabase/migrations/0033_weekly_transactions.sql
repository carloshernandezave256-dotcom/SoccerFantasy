-- One weekly transaction clock for waivers, free agency, trades and roster locks.
create table public.league_transaction_windows (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  gameweek integer not null check (gameweek > 0),
  waiver_process_at timestamptz not null,
  roster_lock_at timestamptz not null,
  priority_randomized_at timestamptz,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (league_id, gameweek),
  check (waiver_process_at < roster_lock_at)
);

create index league_transaction_windows_due_idx
  on public.league_transaction_windows (waiver_process_at)
  where processed_at is null;
create index league_transaction_windows_lock_idx
  on public.league_transaction_windows (roster_lock_at desc);

alter table public.league_transaction_windows enable row level security;
grant select on public.league_transaction_windows to authenticated;
create policy "league members read transaction windows"
on public.league_transaction_windows for select to authenticated
using (private.is_league_member(league_id));

alter table public.waiver_claims
  add column gameweek integer,
  add column claim_rank integer;

update public.waiver_claims
set gameweek = 1,
    claim_rank = ranked.rank
from (
  select id, row_number() over (partition by league_id, user_id order by created_at, id)::integer as rank
  from public.waiver_claims
) ranked
where public.waiver_claims.id = ranked.id;

alter table public.waiver_claims alter column gameweek set not null;
alter table public.waiver_claims alter column claim_rank set not null;
alter table public.waiver_claims add constraint waiver_claims_gameweek_check check (gameweek > 0);
alter table public.waiver_claims add constraint waiver_claims_rank_check check (claim_rank > 0);
create unique index waiver_claims_pending_rank_idx
  on public.waiver_claims (league_id, gameweek, user_id, claim_rank)
  where status = 'pending';
create unique index waiver_claims_pending_player_idx
  on public.waiver_claims (league_id, gameweek, user_id, add_player_id)
  where status = 'pending';

create or replace function private.roster_is_legal(
  p_league_id uuid,
  p_user_id uuid,
  p_remove bigint[] default '{}'::bigint[],
  p_add bigint[] default '{}'::bigint[]
) returns boolean language sql stable security definer set search_path='' as $$
  with projected as (
    select dp.player_id
    from public.draft_picks dp
    where dp.league_id = p_league_id and dp.user_id = p_user_id
      and not (dp.player_id = any(coalesce(p_remove, '{}'::bigint[])))
    union all
    select unnest(coalesce(p_add, '{}'::bigint[]))
  ), counts as (
    select count(*) total,
      count(*) filter (where p.position='GK') gk,
      count(*) filter (where p.position='DEF') def,
      count(*) filter (where p.position='MID') mid,
      count(*) filter (where p.position='FWD') fwd,
      coalesce(max(club_count), 0) max_club
    from projected r join public.players p on p.id=r.player_id
    left join lateral (
      select count(*) club_count from projected r2 join public.players p2 on p2.id=r2.player_id where p2.club=p.club
    ) clubs on true
  )
  select total=18 and gk=2 and def=6 and mid=5 and fwd=5 and max_club<=4 from counts
$$;

create or replace function public.transaction_window(p_league_id uuid)
returns table(gameweek integer, waiver_process_at timestamptz, roster_lock_at timestamptz, phase text)
language sql stable security definer set search_path='' as $$
  select w.gameweek,w.waiver_process_at,w.roster_lock_at,
    case when now()>=w.roster_lock_at then 'locked'
         when w.processed_at is not null or now()>=w.waiver_process_at then 'free_agency'
         else 'waivers' end
  from public.league_transaction_windows w
  where w.league_id=p_league_id and private.is_league_member(p_league_id)
  order by w.gameweek desc limit 1
$$;

create or replace function public.set_transaction_window(p_league_id uuid,p_gameweek integer,p_roster_lock_at timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare v_local timestamp; v_thursday date; v_process timestamptz;
begin
  if not exists(select 1 from public.leagues where id=p_league_id and commissioner_id=(select auth.uid()) and game_format='draft') then
    raise exception 'Only the commissioner can schedule a Draft League gameweek';
  end if;
  if p_gameweek<1 then raise exception 'Gameweek must be at least 1'; end if;
  if p_roster_lock_at<=now() then raise exception 'First kickoff must be in the future'; end if;
  v_local := p_roster_lock_at at time zone 'America/Los_Angeles';
  v_thursday := date_trunc('week',v_local)::date + 3;
  v_process := (v_thursday + time '08:00') at time zone 'America/Los_Angeles';
  if v_process>=p_roster_lock_at then raise exception 'First kickoff must be after Thursday at 8:00 AM Pacific'; end if;
  insert into public.league_transaction_windows(league_id,gameweek,waiver_process_at,roster_lock_at)
  values(p_league_id,p_gameweek,v_process,p_roster_lock_at)
  on conflict(league_id,gameweek) do update set waiver_process_at=excluded.waiver_process_at,
    roster_lock_at=excluded.roster_lock_at,updated_at=now()
  where public.league_transaction_windows.processed_at is null;
  if not found then raise exception 'A processed gameweek schedule cannot be changed'; end if;
end$$;

create or replace function public.submit_waiver_claim(p_league_id uuid,p_add_player_id bigint,p_drop_player_id bigint)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_claim uuid;v_week integer;v_rank integer;
begin
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
end$$;

create or replace function public.reorder_waiver_claims(p_league_id uuid,p_claim_ids uuid[])
returns void language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_week integer;v_count integer;
begin
  select gameweek into v_week from public.league_transaction_windows where league_id=p_league_id and now()<waiver_process_at order by gameweek desc limit 1;
  if v_week is null then raise exception 'Waiver claims are closed';end if;
  select count(*) into v_count from public.waiver_claims where league_id=p_league_id and gameweek=v_week and user_id=v_user and status='pending';
  if v_count<>coalesce(cardinality(p_claim_ids),0) or exists(select 1 from unnest(p_claim_ids) x left join public.waiver_claims c on c.id=x where c.id is null or c.league_id<>p_league_id or c.gameweek<>v_week or c.user_id<>v_user or c.status<>'pending') then raise exception 'Submit every pending claim exactly once';end if;
  update public.waiver_claims set claim_rank=-claim_rank where league_id=p_league_id and gameweek=v_week and user_id=v_user and status='pending';
  update public.waiver_claims c set claim_rank=o.rank from unnest(p_claim_ids) with ordinality o(id,rank) where c.id=o.id;
end$$;

create or replace function private.process_due_waivers()
returns integer language plpgsql security definer set search_path='' as $$
declare w public.league_transaction_windows%rowtype;c record;v_success integer:=0;v_max integer;
begin
  for w in select * from public.league_transaction_windows where processed_at is null and waiver_process_at<=now() order by waiver_process_at for update skip locked loop
    perform pg_advisory_xact_lock(hashtextextended(w.league_id::text,0));
    update public.league_members m set waiver_priority=r.rank from (
      select user_id,row_number() over(order by random())::integer rank from public.league_members where league_id=w.league_id
    ) r where m.league_id=w.league_id and m.user_id=r.user_id;
    update public.league_transaction_windows set priority_randomized_at=now() where id=w.id;
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
    update public.league_transaction_windows set processed_at=now(),updated_at=now() where id=w.id;
  end loop;
  return v_success;
end$$;

create or replace function public.pickup_free_agent(p_league_id uuid,p_add_player_id bigint,p_drop_player_id bigint)
returns void language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());w public.league_transaction_windows%rowtype;
begin
  if v_user is null or not private.is_league_member(p_league_id) then raise exception 'League membership required';end if;
  perform pg_advisory_xact_lock(hashtextextended(p_league_id::text,0));
  select * into w from public.league_transaction_windows where league_id=p_league_id order by gameweek desc limit 1 for update;
  if not found or w.processed_at is null or now()>=w.roster_lock_at then raise exception 'Immediate free-agent pickups are not open';end if;
  if exists(select 1 from public.draft_picks where league_id=p_league_id and player_id=p_add_player_id) then raise exception 'That player is already owned';end if;
  if not exists(select 1 from public.draft_picks where league_id=p_league_id and user_id=v_user and player_id=p_drop_player_id) then raise exception 'Choose a player from your roster to drop';end if;
  if not private.roster_is_legal(p_league_id,v_user,array[p_drop_player_id],array[p_add_player_id]) then raise exception 'That move would break roster limits';end if;
  delete from public.lineup_players where league_id=p_league_id and user_id=v_user and player_id=p_drop_player_id;
  update public.draft_picks set player_id=p_add_player_id,picked_at=now(),auto_picked=false where league_id=p_league_id and user_id=v_user and player_id=p_drop_player_id;
end$$;

create or replace function private.transactions_open(p_league_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce((select now()<w.roster_lock_at from public.league_transaction_windows w where w.league_id=p_league_id order by gameweek desc limit 1),false)
$$;

create or replace function public.respond_to_trade(p_trade_id uuid,p_accept boolean)
returns public.trade_status language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_trade public.trades%rowtype;v_expected int;v_owned int;v_offered bigint[];v_requested bigint[];
begin
  select * into v_trade from public.trades where id=p_trade_id for update;
  if not found then raise exception 'Trade not found';end if;
  if v_trade.recipient_id<>v_user then raise exception 'Only the recipient can respond';end if;
  if v_trade.status<>'pending' then raise exception 'This trade is no longer pending';end if;
  if not p_accept then update public.trades set status='declined',responded_at=now() where id=p_trade_id;return 'declined';end if;
  if not coalesce((select trades_enabled from public.leagues where id=v_trade.league_id),false) or not private.transactions_open(v_trade.league_id) then raise exception 'Trades are closed for this gameweek';end if;
  perform pg_advisory_xact_lock(hashtextextended(v_trade.league_id::text,0));
  select count(*) into v_expected from public.trade_players where trade_id=p_trade_id;
  select count(*) into v_owned from public.trade_players tp join public.draft_picks dp on dp.league_id=v_trade.league_id and dp.player_id=tp.player_id and dp.user_id=tp.from_user_id where tp.trade_id=p_trade_id;
  if v_owned<>v_expected then raise exception 'Player ownership changed; this trade is invalid';end if;
  select array_agg(player_id order by player_id) filter(where from_user_id=v_trade.proposer_id),array_agg(player_id order by player_id) filter(where from_user_id=v_trade.recipient_id) into v_offered,v_requested from public.trade_players where trade_id=p_trade_id;
  if not private.roster_is_legal(v_trade.league_id,v_trade.proposer_id,v_offered,v_requested) or not private.roster_is_legal(v_trade.league_id,v_trade.recipient_id,v_requested,v_offered) then raise exception 'This trade would break roster composition or the four-per-club limit';end if;
  delete from public.lineup_players where league_id=v_trade.league_id and player_id in(select player_id from public.trade_players where trade_id=p_trade_id);
  update public.draft_picks dp set user_id=case when tp.from_user_id=v_trade.proposer_id then v_trade.recipient_id else v_trade.proposer_id end from public.trade_players tp where tp.trade_id=p_trade_id and dp.league_id=v_trade.league_id and dp.player_id=tp.player_id and dp.user_id=tp.from_user_id;
  update public.trades set status='accepted',responded_at=now() where id=p_trade_id;
  return 'accepted';
end$$;

-- Offers are manager-to-manager. There is intentionally no commissioner approval path.
create or replace function public.create_trade_offer(p_league_id uuid,p_recipient_id uuid,p_offered bigint[],p_requested bigint[],p_note text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_trade uuid;v_count int;
begin
  if v_user is null then raise exception 'Authentication required';end if;
  if not coalesce((select trades_enabled from public.leagues where id=p_league_id),false) or not private.transactions_open(p_league_id) then raise exception 'Trades are closed for this gameweek';end if;
  if p_recipient_id=v_user then raise exception 'Choose another manager';end if;
  if cardinality(p_offered)<1 or cardinality(p_offered)<>cardinality(p_requested) then raise exception 'Select the same number of players from both teams';end if;
  if cardinality(p_offered)<>cardinality(array(select distinct unnest(p_offered))) or cardinality(p_requested)<>cardinality(array(select distinct unnest(p_requested))) then raise exception 'Duplicate players are not allowed';end if;
  if not exists(select 1 from public.league_members where league_id=p_league_id and user_id=v_user) or not exists(select 1 from public.league_members where league_id=p_league_id and user_id=p_recipient_id) then raise exception 'Both managers must belong to this league';end if;
  select count(*) into v_count from public.draft_picks where league_id=p_league_id and user_id=v_user and player_id=any(p_offered);if v_count<>cardinality(p_offered) then raise exception 'You no longer own every offered player';end if;
  select count(*) into v_count from public.draft_picks where league_id=p_league_id and user_id=p_recipient_id and player_id=any(p_requested);if v_count<>cardinality(p_requested) then raise exception 'The recipient no longer owns every requested player';end if;
  if not private.roster_is_legal(p_league_id,v_user,p_offered,p_requested) or not private.roster_is_legal(p_league_id,p_recipient_id,p_requested,p_offered) then raise exception 'This trade would break roster composition or the four-per-club limit';end if;
  insert into public.trades(league_id,proposer_id,recipient_id,note) values(p_league_id,v_user,p_recipient_id,nullif(trim(p_note),'')) returning id into v_trade;
  insert into public.trade_players(trade_id,player_id,from_user_id) select v_trade,x,v_user from unnest(p_offered)x;
  insert into public.trade_players(trade_id,player_id,from_user_id) select v_trade,x,p_recipient_id from unnest(p_requested)x;
  return v_trade;
end$$;

revoke all on function public.transaction_window(uuid),public.set_transaction_window(uuid,integer,timestamptz),public.reorder_waiver_claims(uuid,uuid[]),public.pickup_free_agent(uuid,bigint,bigint) from public,anon;
grant execute on function public.transaction_window(uuid),public.set_transaction_window(uuid,integer,timestamptz),public.reorder_waiver_claims(uuid,uuid[]),public.pickup_free_agent(uuid,bigint,bigint) to authenticated;
revoke all on function private.process_due_waivers(),private.roster_is_legal(uuid,uuid,bigint[],bigint[]),private.transactions_open(uuid) from public,anon,authenticated;

do $$ begin
  if exists(select 1 from cron.job where jobname='soccer-fantasy-waivers') then perform cron.unschedule('soccer-fantasy-waivers'); end if;
  perform cron.schedule('soccer-fantasy-waivers','*/5 * * * *','select private.process_due_waivers();');
end $$;
