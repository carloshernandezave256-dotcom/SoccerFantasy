-- Live Auction League: exclusive players, $2B budgets, atomic bidding and
-- manager-nomination or mystery-reveal player selection.
alter table public.leagues drop constraint if exists leagues_game_format_check;
alter table public.leagues add constraint leagues_game_format_check check(game_format in('draft','pack','auction'));
alter table public.leagues add column if not exists auction_style text;
alter table public.leagues drop constraint if exists leagues_auction_style_check;
alter table public.leagues add constraint leagues_auction_style_check check(
  (game_format='auction' and auction_style in('nomination','mystery')) or
  (game_format<>'auction' and auction_style is null)
);

alter table public.draft_picks add column if not exists auction_price bigint;

drop function if exists public.my_leagues();
create function public.my_leagues()
returns table(
  league_id uuid,league_name text,invite_code text,league_size smallint,
  manager_count bigint,team_name text,is_commissioner boolean,game_format text,
  player_pool text,auction_style text
)
language sql security definer set search_path='' stable as $$
select l.id,l.name,l.invite_code,l.size,
  (select count(*) from public.league_members x where x.league_id=l.id),
  m.team_name,m.role='commissioner',l.game_format,l.player_pool,l.auction_style
from public.league_members m join public.leagues l on l.id=m.league_id
where m.user_id=(select auth.uid()) order by l.created_at desc
$$;
revoke all on function public.my_leagues() from public,anon;
grant execute on function public.my_leagues() to authenticated;

create table public.auction_sessions(
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null unique references public.leagues(id) on delete cascade,
  draft_id uuid not null unique references public.drafts(id) on delete cascade,
  style text not null check(style in('nomination','mystery')),
  status text not null default 'waiting' check(status in('waiting','nomination','reveal','bidding','complete')),
  starting_budget bigint not null default 2000000000 check(starting_budget>0),
  minimum_bid bigint not null default 1000000 check(minimum_bid>0),
  bid_increment bigint not null default 1000000 check(bid_increment>0),
  bid_seconds smallint not null default 20 check(bid_seconds between 10 and 120),
  current_nominator_slot smallint not null default 1,
  current_lot_id uuid,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.auction_budgets(
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  remaining_budget bigint not null default 2000000000 check(remaining_budget>=0),
  primary key(league_id,user_id)
);

create table public.auction_lots(
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.auction_sessions(id) on delete cascade,
  league_id uuid not null references public.leagues(id) on delete cascade,
  sequence_no smallint not null,
  player_id bigint not null references public.players(id),
  nominated_by uuid references public.profiles(id),
  current_bid bigint,
  current_bidder_id uuid references public.profiles(id),
  status text not null default 'open' check(status in('open','sold','unsold')),
  closes_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique(session_id,sequence_no)
);
alter table public.auction_sessions add constraint auction_sessions_current_lot_fkey
  foreign key(current_lot_id) references public.auction_lots(id) on delete set null;

create table public.auction_bids(
  id bigint generated always as identity primary key,
  league_id uuid not null references public.leagues(id) on delete cascade,
  lot_id uuid not null references public.auction_lots(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount bigint not null check(amount>0),
  created_at timestamptz not null default now()
);

create index auction_bids_lot_created_idx on public.auction_bids(lot_id,created_at desc);
create index auction_lots_league_status_idx on public.auction_lots(league_id,status);

alter table public.auction_sessions enable row level security;
alter table public.auction_budgets enable row level security;
alter table public.auction_lots enable row level security;
alter table public.auction_bids enable row level security;

grant select on public.auction_sessions,public.auction_budgets,public.auction_lots,public.auction_bids to authenticated;
grant usage,select on sequence public.auction_bids_id_seq to authenticated;
create policy "members read auction sessions" on public.auction_sessions for select to authenticated using((select private.is_league_member(league_id)));
create policy "members read auction budgets" on public.auction_budgets for select to authenticated using((select private.is_league_member(league_id)));
create policy "members read auction lots" on public.auction_lots for select to authenticated using((select private.is_league_member(league_id)));
create policy "members read auction bids" on public.auction_bids for select to authenticated using((select private.is_league_member(league_id)));

do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='auction_sessions') then alter publication supabase_realtime add table public.auction_sessions; end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='auction_budgets') then alter publication supabase_realtime add table public.auction_budgets; end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='auction_lots') then alter publication supabase_realtime add table public.auction_lots; end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='auction_bids') then alter publication supabase_realtime add table public.auction_bids; end if;
end $$;

create or replace function public.create_league(
  p_name text,p_team_name text,p_size smallint,p_draft_pick_seconds smallint,p_trades_enabled boolean,
  p_lineup_lock_minutes smallint,p_game_format text,p_calendar_competition text,p_player_pool text,
  p_auction_style text default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_id uuid;v_code text;v_calendar text;
begin
  if v_user is null then raise exception 'Authentication required';end if;
  if p_size not in(8,10,12) then raise exception 'League size must be 8, 10, or 12';end if;
  if p_draft_pick_seconds not in(30,60,90,120) then raise exception 'Choose a valid draft clock';end if;
  if p_lineup_lock_minutes not in(0,15,30,60) then raise exception 'Choose a valid lineup lock time';end if;
  if p_game_format not in('draft','pack','auction') then raise exception 'Choose Draft, Pack, or Auction League';end if;
  if p_game_format='auction' and p_auction_style not in('nomination','mystery') then raise exception 'Choose an Auction Style';end if;
  if p_player_pool not in('All Top Five','Premier League','La Liga','Serie A','Bundesliga','Ligue 1') then raise exception 'Choose a supported player pool';end if;
  v_calendar:=case when p_player_pool='All Top Five' then p_calendar_competition else p_player_pool end;
  if v_calendar not in('Premier League','La Liga','Serie A','Bundesliga','Ligue 1') then raise exception 'Choose a supported Fantasy Calendar';end if;
  v_code:='XI-'||upper(substr(md5(gen_random_uuid()::text),1,6));
  insert into public.leagues(name,invite_code,size,commissioner_id,draft_pick_seconds,trades_enabled,lineup_lock_minutes,game_format,calendar_competition,player_pool,auction_style)
  values(trim(p_name),v_code,p_size,v_user,p_draft_pick_seconds,p_trades_enabled,p_lineup_lock_minutes,p_game_format,v_calendar,p_player_pool,case when p_game_format='auction' then p_auction_style else null end) returning id into v_id;
  insert into public.league_members(league_id,user_id,team_name,role,draft_slot,waiver_priority)
  values(v_id,v_user,trim(p_team_name),'commissioner',1,1);
  if p_game_format='pack' then insert into public.pack_wallets(league_id,user_id) values(v_id,v_user);end if;
  return v_id;
end$$;

create or replace function public.start_auction(p_league_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_league public.leagues%rowtype;v_members integer;v_draft uuid;v_session uuid;
begin
  select * into v_league from public.leagues where id=p_league_id and commissioner_id=v_user and game_format='auction' for update;
  if not found then raise exception 'Only the Auction League commissioner can start this auction';end if;
  if exists(select 1 from public.auction_sessions where league_id=p_league_id) then raise exception 'Auction already started';end if;
  select count(*) into v_members from public.league_members where league_id=p_league_id;
  if v_members<3 then raise exception 'At least 3 managers are required';end if;
  with randomized as(select user_id,row_number() over(order by random())::smallint slot from public.league_members where league_id=p_league_id)
  update public.league_members m set draft_slot=r.slot from randomized r where m.league_id=p_league_id and m.user_id=r.user_id;
  insert into public.drafts(league_id,status,pick_seconds,current_pick,pick_deadline,started_at)
  values(p_league_id,'live',20,1,null,now()) returning id into v_draft;
  insert into public.auction_sessions(league_id,draft_id,style,status,current_nominator_slot)
  values(p_league_id,v_draft,v_league.auction_style,case when v_league.auction_style='nomination' then 'nomination' else 'reveal' end,1) returning id into v_session;
  insert into public.auction_budgets(league_id,user_id,remaining_budget)
  select p_league_id,user_id,2000000000 from public.league_members where league_id=p_league_id;
  update public.leagues set joining_open=false where id=p_league_id;
  return v_session;
end$$;

create or replace function private.auction_player_allowed(p_league_id uuid,p_player_id bigint)
returns boolean language sql security definer set search_path='' stable as $$
select exists(select 1 from public.players p join public.leagues l on l.id=p_league_id
  where p.id=p_player_id and p.active and (l.player_pool='All Top Five' or p.competition=l.player_pool))
$$;

create or replace function private.auction_max_bid(p_league_id uuid,p_user_id uuid)
returns bigint language sql security definer set search_path='' stable as $$
select greatest(0,b.remaining_budget-(greatest(0,18-count(dp.id)-1)*s.minimum_bid))::bigint
from public.auction_budgets b join public.auction_sessions s on s.league_id=b.league_id
left join public.draft_picks dp on dp.league_id=b.league_id and dp.user_id=b.user_id
where b.league_id=p_league_id and b.user_id=p_user_id group by b.remaining_budget,s.minimum_bid
$$;

create or replace function private.open_auction_lot(p_league_id uuid,p_player_id bigint,p_nominated_by uuid,p_opening_bid bigint default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_session public.auction_sessions%rowtype;v_lot uuid;v_sequence smallint;
begin
  select * into v_session from public.auction_sessions where league_id=p_league_id for update;
  if v_session.status not in('nomination','reveal') or v_session.current_lot_id is not null then raise exception 'The room is not ready for another player';end if;
  if not private.auction_player_allowed(p_league_id,p_player_id) then raise exception 'That player is outside this league pool';end if;
  if exists(select 1 from public.draft_picks where league_id=p_league_id and player_id=p_player_id)
    or exists(select 1 from public.auction_lots where league_id=p_league_id and player_id=p_player_id and status in('open','sold'))
  then raise exception 'That player is already owned or currently up for auction';end if;
  select coalesce(max(sequence_no),0)+1 into v_sequence from public.auction_lots where session_id=v_session.id;
  insert into public.auction_lots(session_id,league_id,sequence_no,player_id,nominated_by,current_bid,current_bidder_id,closes_at)
  values(v_session.id,p_league_id,v_sequence,p_player_id,p_nominated_by,p_opening_bid,case when p_opening_bid is null then null else p_nominated_by end,now()+make_interval(secs=>v_session.bid_seconds)) returning id into v_lot;
  if p_opening_bid is not null then insert into public.auction_bids(league_id,lot_id,user_id,amount) values(p_league_id,v_lot,p_nominated_by,p_opening_bid);end if;
  update public.auction_sessions set status='bidding',current_lot_id=v_lot,updated_at=now() where id=v_session.id;
  return v_lot;
end$$;

create or replace function public.nominate_auction_player(p_league_id uuid,p_player_id bigint,p_opening_bid bigint default 1000000)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_session public.auction_sessions%rowtype;v_slot smallint;
begin
  select * into v_session from public.auction_sessions where league_id=p_league_id for update;
  if v_session.style<>'nomination' or v_session.status<>'nomination' then raise exception 'Player nomination is not open';end if;
  select draft_slot into v_slot from public.league_members where league_id=p_league_id and user_id=v_user;
  if v_slot is distinct from v_session.current_nominator_slot then raise exception 'Another manager is nominating';end if;
  if p_opening_bid<v_session.minimum_bid or mod(p_opening_bid,v_session.bid_increment)<>0 then raise exception 'Opening bid must use $1M increments';end if;
  if not private.draft_pick_is_valid(p_league_id,v_user,p_player_id) then raise exception 'That player would break your roster limits';end if;
  if p_opening_bid>private.auction_max_bid(p_league_id,v_user) then raise exception 'That bid would leave too little budget to complete your roster';end if;
  return private.open_auction_lot(p_league_id,p_player_id,v_user,p_opening_bid);
end$$;

create or replace function public.reveal_auction_player(p_league_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_session public.auction_sessions%rowtype;v_player bigint;
begin
  if not exists(select 1 from public.league_members where league_id=p_league_id and user_id=v_user) then raise exception 'League membership required';end if;
  select * into v_session from public.auction_sessions where league_id=p_league_id for update;
  if v_session.style<>'mystery' or v_session.status<>'reveal' then raise exception 'Mystery Reveal is not ready';end if;
  select p.id into v_player from public.players p join public.leagues l on l.id=p_league_id
  where p.active and (l.player_pool='All Top Five' or p.competition=l.player_pool)
    and not exists(select 1 from public.auction_lots x where x.league_id=p_league_id and x.player_id=p.id and x.status in('open','sold'))
    and exists(select 1 from public.league_members m where m.league_id=p_league_id and private.draft_pick_is_valid(p_league_id,m.user_id,p.id))
  order by random() limit 1;
  if v_player is null then raise exception 'No eligible mystery players remain';end if;
  return private.open_auction_lot(p_league_id,v_player,null,null);
end$$;

create or replace function public.place_auction_bid(p_league_id uuid,p_amount bigint)
returns bigint language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_session public.auction_sessions%rowtype;v_lot public.auction_lots%rowtype;v_id bigint;
begin
  select * into v_session from public.auction_sessions where league_id=p_league_id for update;
  if v_session.status<>'bidding' or v_session.current_lot_id is null then raise exception 'Bidding is closed';end if;
  select * into v_lot from public.auction_lots where id=v_session.current_lot_id for update;
  if now()>=v_lot.closes_at then raise exception 'Bid timer expired';end if;
  if not exists(select 1 from public.league_members where league_id=p_league_id and user_id=v_user) then raise exception 'League membership required';end if;
  if not private.draft_pick_is_valid(p_league_id,v_user,v_lot.player_id) then raise exception 'That player would break your roster limits';end if;
  if p_amount<coalesce(v_lot.current_bid-v_session.bid_increment,v_session.minimum_bid-v_session.bid_increment)+v_session.bid_increment or mod(p_amount,v_session.bid_increment)<>0 then raise exception 'Bid must beat the leader by at least $1M';end if;
  if p_amount>private.auction_max_bid(p_league_id,v_user) then raise exception 'That bid would leave too little budget to complete your roster';end if;
  insert into public.auction_bids(league_id,lot_id,user_id,amount) values(p_league_id,v_lot.id,v_user,p_amount) returning id into v_id;
  update public.auction_lots set current_bid=p_amount,current_bidder_id=v_user,
    closes_at=case when closes_at-now()<interval '6 seconds' then now()+interval '6 seconds' else closes_at end where id=v_lot.id;
  update public.auction_sessions set updated_at=now() where id=v_session.id;
  return v_id;
end$$;

create or replace function public.settle_auction_lot(p_league_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_session public.auction_sessions%rowtype;v_lot public.auction_lots%rowtype;v_pick smallint;v_members integer;v_next_slot smallint;v_complete boolean;
begin
  if not exists(select 1 from public.league_members where league_id=p_league_id and user_id=v_user) then raise exception 'League membership required';end if;
  select * into v_session from public.auction_sessions where league_id=p_league_id for update;
  if v_session.status<>'bidding' or v_session.current_lot_id is null then return v_session.status;end if;
  select * into v_lot from public.auction_lots where id=v_session.current_lot_id for update;
  if now()<v_lot.closes_at then return 'bidding';end if;
  if v_lot.current_bidder_id is null then update public.auction_lots set status='unsold' where id=v_lot.id;
  else
    select coalesce(max(pick_number),0)+1 into v_pick from public.draft_picks where league_id=p_league_id;
    select count(*) into v_members from public.league_members where league_id=p_league_id;
    insert into public.draft_picks(draft_id,league_id,pick_number,round,user_id,player_id,auction_price)
    values(v_session.draft_id,p_league_id,v_pick,least(18,((v_pick-1)/v_members)+1),v_lot.current_bidder_id,v_lot.player_id,v_lot.current_bid);
    update public.auction_budgets set remaining_budget=remaining_budget-v_lot.current_bid where league_id=p_league_id and user_id=v_lot.current_bidder_id;
    update public.auction_lots set status='sold' where id=v_lot.id;
  end if;
  select not exists(select 1 from public.league_members m where m.league_id=p_league_id and (select count(*) from public.draft_picks dp where dp.league_id=p_league_id and dp.user_id=m.user_id)<18) into v_complete;
  if v_complete then
    update public.auction_sessions set status='complete',current_lot_id=null,updated_at=now() where id=v_session.id;
    update public.drafts set status='complete',pick_deadline=null,updated_at=now() where id=v_session.draft_id;
    return 'complete';
  end if;
  select m.draft_slot into v_next_slot from public.league_members m where m.league_id=p_league_id
    and (select count(*) from public.draft_picks dp where dp.league_id=p_league_id and dp.user_id=m.user_id)<18
  order by case when m.draft_slot>v_session.current_nominator_slot then 0 else 1 end,m.draft_slot limit 1;
  update public.auction_sessions set status=case when style='nomination' then 'nomination' else 'reveal' end,
    current_lot_id=null,current_nominator_slot=v_next_slot,updated_at=now() where id=v_session.id;
  return case when v_session.style='nomination' then 'nomination' else 'reveal' end;
end$$;

revoke all on function public.create_league(text,text,smallint,smallint,boolean,smallint,text,text,text,text),public.start_auction(uuid),public.nominate_auction_player(uuid,bigint,bigint),public.reveal_auction_player(uuid),public.place_auction_bid(uuid,bigint),public.settle_auction_lot(uuid) from public,anon;
grant execute on function public.create_league(text,text,smallint,smallint,boolean,smallint,text,text,text,text),public.start_auction(uuid),public.nominate_auction_player(uuid,bigint,bigint),public.reveal_auction_player(uuid),public.place_auction_bid(uuid,bigint),public.settle_auction_lot(uuid) to authenticated;
revoke all on function private.auction_player_allowed(uuid,bigint),private.auction_max_bid(uuid,uuid),private.open_auction_lot(uuid,bigint,uuid,bigint) from public,anon,authenticated;

create or replace function public.set_transaction_window(p_league_id uuid,p_gameweek integer,p_roster_lock_at timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare v_local timestamp;v_thursday date;v_process timestamptz;
begin
  if not exists(select 1 from public.leagues where id=p_league_id and commissioner_id=(select auth.uid()) and game_format in('draft','auction')) then raise exception 'Only the commissioner can schedule this league gameweek';end if;
  if p_gameweek<1 then raise exception 'Gameweek must be at least 1';end if;
  if p_roster_lock_at<=now() then raise exception 'First kickoff must be in the future';end if;
  v_local:=p_roster_lock_at at time zone 'America/Los_Angeles';v_thursday:=date_trunc('week',v_local)::date+3;v_process:=(v_thursday+time '08:00') at time zone 'America/Los_Angeles';
  if v_process>=p_roster_lock_at then raise exception 'First kickoff must be after Thursday at 8:00 AM Pacific';end if;
  insert into public.league_transaction_windows(league_id,gameweek,waiver_process_at,roster_lock_at) values(p_league_id,p_gameweek,v_process,p_roster_lock_at)
  on conflict(league_id,gameweek) do update set waiver_process_at=excluded.waiver_process_at,roster_lock_at=excluded.roster_lock_at,updated_at=now() where public.league_transaction_windows.processed_at is null;
  if not found then raise exception 'A processed gameweek schedule cannot be changed';end if;
end$$;
