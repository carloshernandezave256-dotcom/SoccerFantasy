create type public.trade_status as enum ('pending','accepted','declined','cancelled');

create table public.trades(
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  proposer_id uuid not null references public.profiles(id),
  recipient_id uuid not null references public.profiles(id),
  status public.trade_status not null default 'pending',
  note text check(note is null or char_length(note)<=280),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check(proposer_id<>recipient_id)
);

create table public.trade_players(
  trade_id uuid not null references public.trades(id) on delete cascade,
  player_id bigint not null references public.players(id),
  from_user_id uuid not null references public.profiles(id),
  primary key(trade_id,player_id)
);

create index trades_league_idx on public.trades(league_id,created_at desc);
create index trades_proposer_idx on public.trades(proposer_id,status);
create index trades_recipient_idx on public.trades(recipient_id,status);
create index trade_players_player_idx on public.trade_players(player_id);
create index trade_players_from_user_idx on public.trade_players(from_user_id);

alter table public.trades enable row level security;
alter table public.trade_players enable row level security;
grant select on public.trades,public.trade_players to authenticated;
revoke insert,update,delete on public.trades,public.trade_players from anon,authenticated;

create policy "league members read trades" on public.trades for select to authenticated
using(exists(select 1 from public.league_members m where m.league_id=trades.league_id and m.user_id=(select auth.uid())));

create policy "league members read trade players" on public.trade_players for select to authenticated
using(exists(select 1 from public.trades t join public.league_members m on m.league_id=t.league_id where t.id=trade_players.trade_id and m.user_id=(select auth.uid())));

create function public.create_trade_offer(p_league_id uuid,p_recipient_id uuid,p_offered bigint[],p_requested bigint[],p_note text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_trade uuid;v_count int;
begin
  if v_user is null then raise exception 'Authentication required';end if;
  if p_recipient_id=v_user then raise exception 'Choose another manager';end if;
  if cardinality(p_offered)<1 or cardinality(p_requested)<1 then raise exception 'Select at least one player from each team';end if;
  if cardinality(p_offered)<>cardinality(array(select distinct unnest(p_offered))) or cardinality(p_requested)<>cardinality(array(select distinct unnest(p_requested))) then raise exception 'Duplicate players are not allowed';end if;
  if p_offered&&p_requested then raise exception 'A player cannot appear on both sides';end if;
  if not exists(select 1 from public.league_members where league_id=p_league_id and user_id=v_user) then raise exception 'League membership required';end if;
  if not exists(select 1 from public.league_members where league_id=p_league_id and user_id=p_recipient_id) then raise exception 'Recipient is not in this league';end if;
  select count(*) into v_count from public.draft_picks where league_id=p_league_id and user_id=v_user and player_id=any(p_offered);
  if v_count<>cardinality(p_offered) then raise exception 'You no longer own every offered player';end if;
  select count(*) into v_count from public.draft_picks where league_id=p_league_id and user_id=p_recipient_id and player_id=any(p_requested);
  if v_count<>cardinality(p_requested) then raise exception 'The recipient no longer owns every requested player';end if;
  insert into public.trades(league_id,proposer_id,recipient_id,note) values(p_league_id,v_user,p_recipient_id,nullif(trim(p_note),'')) returning id into v_trade;
  insert into public.trade_players(trade_id,player_id,from_user_id) select v_trade,x,v_user from unnest(p_offered)x;
  insert into public.trade_players(trade_id,player_id,from_user_id) select v_trade,x,p_recipient_id from unnest(p_requested)x;
  return v_trade;
end$$;

create function public.respond_to_trade(p_trade_id uuid,p_accept boolean)
returns public.trade_status language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_trade public.trades%rowtype;v_expected int;v_owned int;
begin
  select * into v_trade from public.trades where id=p_trade_id for update;
  if not found then raise exception 'Trade not found';end if;
  if v_trade.recipient_id<>v_user then raise exception 'Only the recipient can respond';end if;
  if v_trade.status<>'pending' then raise exception 'This trade is no longer pending';end if;
  if not p_accept then update public.trades set status='declined',responded_at=now() where id=p_trade_id;return 'declined';end if;
  select count(*) into v_expected from public.trade_players where trade_id=p_trade_id;
  select count(*) into v_owned from public.trade_players tp join public.draft_picks dp on dp.league_id=v_trade.league_id and dp.player_id=tp.player_id and dp.user_id=tp.from_user_id where tp.trade_id=p_trade_id;
  if v_owned<>v_expected then raise exception 'Player ownership changed; this trade is invalid';end if;
  delete from public.lineup_players where league_id=v_trade.league_id and player_id in(select player_id from public.trade_players where trade_id=p_trade_id);
  update public.draft_picks dp set user_id=case when tp.from_user_id=v_trade.proposer_id then v_trade.recipient_id else v_trade.proposer_id end
  from public.trade_players tp where tp.trade_id=p_trade_id and dp.league_id=v_trade.league_id and dp.player_id=tp.player_id and dp.user_id=tp.from_user_id;
  update public.trades set status='accepted',responded_at=now() where id=p_trade_id;
  return 'accepted';
end$$;

create function public.cancel_trade(p_trade_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  update public.trades set status='cancelled',responded_at=now() where id=p_trade_id and proposer_id=(select auth.uid()) and status='pending';
  if not found then raise exception 'Pending trade not found or not owned by you';end if;
end$$;

revoke all on function public.create_trade_offer(uuid,uuid,bigint[],bigint[],text) from public,anon;
revoke all on function public.respond_to_trade(uuid,boolean) from public,anon;
revoke all on function public.cancel_trade(uuid) from public,anon;
grant execute on function public.create_trade_offer(uuid,uuid,bigint[],bigint[],text) to authenticated;
grant execute on function public.respond_to_trade(uuid,boolean) to authenticated;
grant execute on function public.cancel_trade(uuid) to authenticated;

comment on function public.create_trade_offer(uuid,uuid,bigint[],bigint[],text) is 'Authenticated trade proposal; validates league membership and current ownership.';
comment on function public.respond_to_trade(uuid,boolean) is 'Authenticated recipient-only response; locks and atomically transfers ownership after revalidation.';
