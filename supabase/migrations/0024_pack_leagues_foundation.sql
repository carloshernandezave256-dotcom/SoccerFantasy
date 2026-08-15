alter table public.leagues add column if not exists game_format text not null default 'draft';
alter table public.leagues drop constraint if exists leagues_game_format_check;
alter table public.leagues add constraint leagues_game_format_check check(game_format in('draft','pack'));

alter table public.players add column if not exists is_club_captain boolean not null default false;

create table if not exists public.pack_wallets(
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  coins integer not null default 0 check(coins>=0),
  pack_tokens integer not null default 0 check(pack_tokens>=0),
  updated_at timestamptz not null default now(),
  primary key(league_id,user_id),
  foreign key(league_id,user_id) references public.league_members(league_id,user_id) on delete cascade
);

create table if not exists public.pack_cards(
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  player_id bigint not null references public.players(id),
  acquired_via text not null check(acquired_via in('starter_captain','starter_superstar','starter_regular','regular_pack','position_pack','captain_pack','superstar_pack','trade','auction')),
  active_slot smallint check(active_slot between 1 and 18),
  acquired_at timestamptz not null default now(),
  foreign key(league_id,user_id) references public.league_members(league_id,user_id) on delete cascade
);
create index if not exists pack_cards_owner_idx on public.pack_cards(league_id,user_id,acquired_at);
create index if not exists pack_cards_player_idx on public.pack_cards(league_id,player_id);
create unique index if not exists pack_cards_active_slot_idx on public.pack_cards(league_id,user_id,active_slot) where active_slot is not null;
create unique index if not exists pack_cards_one_active_copy_idx on public.pack_cards(league_id,user_id,player_id) where active_slot is not null;

create table if not exists public.pack_openings(
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  pack_type text not null check(pack_type in('starter','regular','position_gk','position_def','position_mid','position_fwd','captain','superstar')),
  coin_cost integer not null default 0 check(coin_cost>=0),
  opened_at timestamptz not null default now(),
  foreign key(league_id,user_id) references public.league_members(league_id,user_id) on delete cascade
);

alter table public.pack_wallets enable row level security;
alter table public.pack_cards enable row level security;
alter table public.pack_openings enable row level security;
revoke all on public.pack_wallets,public.pack_cards,public.pack_openings from anon,authenticated;
grant select on public.players to authenticated;

create policy "members read league pack wallets" on public.pack_wallets for select to authenticated
using(exists(select 1 from public.league_members m where m.league_id=pack_wallets.league_id and m.user_id=(select auth.uid())));
create policy "members read league collections" on public.pack_cards for select to authenticated
using(exists(select 1 from public.league_members m where m.league_id=pack_cards.league_id and m.user_id=(select auth.uid())));
create policy "users read own pack history" on public.pack_openings for select to authenticated
using(user_id=(select auth.uid()));

create or replace function public.enforce_pack_collection_limit() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if (select game_format from public.leagues where id=new.league_id)<>'pack' then raise exception 'Cards belong to Pack Leagues only'; end if;
  if (select count(*) from public.pack_cards where league_id=new.league_id and user_id=new.user_id)>=50 then raise exception 'Collection limit reached (50 cards)'; end if;
  return new;
end$$;
drop trigger if exists enforce_pack_collection_limit on public.pack_cards;
create trigger enforce_pack_collection_limit before insert on public.pack_cards for each row execute function public.enforce_pack_collection_limit();

create or replace function public.prevent_league_format_change() returns trigger language plpgsql set search_path='' as $$
begin
  if old.game_format<>new.game_format then raise exception 'League format cannot be changed after creation'; end if;
  return new;
end$$;
drop trigger if exists prevent_league_format_change on public.leagues;
create trigger prevent_league_format_change before update of game_format on public.leagues for each row execute function public.prevent_league_format_change();

drop function if exists public.my_leagues();
create function public.my_leagues()
returns table(league_id uuid,league_name text,invite_code text,league_size smallint,manager_count bigint,team_name text,is_commissioner boolean,game_format text)
language sql security definer set search_path='' stable as $$
select l.id,l.name,l.invite_code,l.size,(select count(*) from public.league_members x where x.league_id=l.id),m.team_name,m.role='commissioner',l.game_format
from public.league_members m join public.leagues l on l.id=m.league_id
where m.user_id=(select auth.uid()) order by l.created_at desc
$$;

create or replace function public.create_league(
  p_name text,p_team_name text,p_size smallint,p_draft_pick_seconds smallint,p_trades_enabled boolean,p_lineup_lock_minutes smallint,p_game_format text
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_id uuid;v_code text;
begin
  if v_user is null then raise exception 'Authentication required';end if;
  if p_size not in(8,10,12) then raise exception 'League size must be 8, 10, or 12';end if;
  if p_draft_pick_seconds not in(30,60,90,120) then raise exception 'Choose a valid draft clock';end if;
  if p_lineup_lock_minutes not in(0,15,30,60) then raise exception 'Choose a valid lineup lock time';end if;
  if p_game_format not in('draft','pack') then raise exception 'Choose Draft League or Pack League';end if;
  v_code:='XI-'||upper(substr(md5(gen_random_uuid()::text),1,6));
  insert into public.leagues(name,invite_code,size,commissioner_id,draft_pick_seconds,trades_enabled,lineup_lock_minutes,game_format)
  values(trim(p_name),v_code,p_size,v_user,p_draft_pick_seconds,p_trades_enabled,p_lineup_lock_minutes,p_game_format) returning id into v_id;
  insert into public.league_members(league_id,user_id,team_name,role,draft_slot) values(v_id,v_user,trim(p_team_name),'commissioner',1);
  if p_game_format='pack' then insert into public.pack_wallets(league_id,user_id) values(v_id,v_user); end if;
  return v_id;
end$$;

create or replace function public.join_league(p_invite_code text,p_team_name text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_league public.leagues%rowtype;v_count int;
begin
  if v_user is null then raise exception 'Authentication required';end if;
  select * into v_league from public.leagues where invite_code=upper(trim(p_invite_code)) for update;
  if not found then raise exception 'Invite code not found';end if;
  if not v_league.joining_open then raise exception 'This league is no longer accepting managers';end if;
  if v_league.game_format='draft' and exists(select 1 from public.drafts where league_id=v_league.id) then raise exception 'This league draft has already started';end if;
  select count(*) into v_count from public.league_members where league_id=v_league.id;
  if v_count>=v_league.size then raise exception 'League is full';end if;
  insert into public.league_members(league_id,user_id,team_name,draft_slot) values(v_league.id,v_user,trim(p_team_name),v_count+1);
  if v_league.game_format='pack' then insert into public.pack_wallets(league_id,user_id) values(v_league.id,v_user); end if;
  return v_league.id;
end$$;

revoke all on function public.my_leagues() from public,anon;
revoke all on function public.create_league(text,text,smallint,smallint,boolean,smallint,text) from public,anon;
grant execute on function public.my_leagues() to authenticated;
grant execute on function public.create_league(text,text,smallint,smallint,boolean,smallint,text) to authenticated;
revoke all on function public.enforce_pack_collection_limit() from public,anon,authenticated;
revoke all on function public.prevent_league_format_change() from public,anon,authenticated;
