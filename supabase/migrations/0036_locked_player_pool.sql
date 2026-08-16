-- Commissioners choose one domestic competition or the app's signature Top Five pool.
alter table public.leagues add column player_pool text not null default 'All Top Five';
alter table public.leagues add constraint leagues_player_pool_check
  check(player_pool in('All Top Five','Premier League','La Liga','Serie A','Bundesliga','Ligue 1'));

create or replace function public.prevent_player_pool_change()
returns trigger language plpgsql set search_path='' as $$
begin
  if old.player_pool<>new.player_pool then raise exception 'The player pool is locked for the season and cannot be changed';end if;
  return new;
end$$;
create trigger prevent_player_pool_change before update of player_pool on public.leagues
for each row execute function public.prevent_player_pool_change();

create or replace function private.player_in_league_pool(p_league_id uuid,p_player_id bigint)
returns boolean language sql security definer set search_path='' stable as $$
  select exists(
    select 1 from public.leagues l join public.players p on p.id=p_player_id
    where l.id=p_league_id and p.active and (l.player_pool='All Top Five' or p.competition=l.player_pool)
  )
$$;

create or replace function private.enforce_league_player_pool()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if not private.player_in_league_pool(new.league_id,new.player_id) then
    raise exception 'That player is outside this league''s locked player pool';
  end if;
  return new;
end$$;
create trigger enforce_draft_pick_pool before insert or update of player_id on public.draft_picks
for each row execute function private.enforce_league_player_pool();
create trigger enforce_draft_queue_pool before insert or update of player_id on public.draft_queue
for each row execute function private.enforce_league_player_pool();
create trigger enforce_pack_card_pool before insert or update of player_id on public.pack_cards
for each row execute function private.enforce_league_player_pool();

create or replace function private.enforce_waiver_player_pool()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if not private.player_in_league_pool(new.league_id,new.add_player_id) then
    raise exception 'That player is outside this league''s locked player pool';
  end if;
  return new;
end$$;
create trigger enforce_waiver_pool before insert or update of add_player_id on public.waiver_claims
for each row execute function private.enforce_waiver_player_pool();

drop function if exists public.create_league(text,text,smallint,smallint,boolean,smallint,text,text);
create function public.create_league(
  p_name text,p_team_name text,p_size smallint,p_draft_pick_seconds smallint,p_trades_enabled boolean,
  p_lineup_lock_minutes smallint,p_game_format text,p_calendar_competition text,p_player_pool text
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_id uuid;v_code text;v_calendar text;
begin
  if v_user is null then raise exception 'Authentication required';end if;
  if p_size not in(8,10,12) then raise exception 'League size must be 8, 10, or 12';end if;
  if p_draft_pick_seconds not in(30,60,90,120) then raise exception 'Choose a valid draft clock';end if;
  if p_lineup_lock_minutes not in(0,15,30,60) then raise exception 'Choose a valid lineup lock time';end if;
  if p_game_format not in('draft','pack') then raise exception 'Choose Draft League or Pack League';end if;
  if p_player_pool not in('All Top Five','Premier League','La Liga','Serie A','Bundesliga','Ligue 1') then raise exception 'Choose a supported player pool';end if;
  v_calendar:=case when p_player_pool='All Top Five' then p_calendar_competition else p_player_pool end;
  if v_calendar not in('Premier League','La Liga','Serie A','Bundesliga','Ligue 1') then raise exception 'Choose a supported Fantasy Calendar';end if;
  v_code:='XI-'||upper(substr(md5(gen_random_uuid()::text),1,6));
  insert into public.leagues(name,invite_code,size,commissioner_id,draft_pick_seconds,trades_enabled,lineup_lock_minutes,game_format,calendar_competition,player_pool)
  values(trim(p_name),v_code,p_size,v_user,p_draft_pick_seconds,p_trades_enabled,p_lineup_lock_minutes,p_game_format,v_calendar,p_player_pool) returning id into v_id;
  insert into public.league_members(league_id,user_id,team_name,role,draft_slot) values(v_id,v_user,trim(p_team_name),'commissioner',1);
  if p_game_format='pack' then insert into public.pack_wallets(league_id,user_id) values(v_id,v_user);end if;
  return v_id;
end$$;

drop function if exists public.my_leagues();
create function public.my_leagues()
returns table(league_id uuid,league_name text,invite_code text,league_size smallint,manager_count bigint,team_name text,is_commissioner boolean,game_format text,player_pool text)
language sql security definer set search_path='' stable as $$
select l.id,l.name,l.invite_code,l.size,(select count(*) from public.league_members x where x.league_id=l.id),m.team_name,m.role='commissioner',l.game_format,l.player_pool
from public.league_members m join public.leagues l on l.id=m.league_id where m.user_id=(select auth.uid()) order by l.created_at desc
$$;

drop function if exists public.league_settings(uuid);
create function public.league_settings(p_league_id uuid)
returns table(league_name text,joining_open boolean,draft_pick_seconds smallint,trades_enabled boolean,lineup_lock_minutes smallint,motm_manual boolean,calendar_competition text,player_pool text)
language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.league_members where league_id=p_league_id and user_id=(select auth.uid())) then raise exception 'League membership required';end if;
  return query select l.name,l.joining_open,l.draft_pick_seconds,l.trades_enabled,l.lineup_lock_minutes,l.motm_manual,l.calendar_competition,l.player_pool from public.leagues l where l.id=p_league_id;
end$$;

create or replace function public.claim_pack_starter(p_league_id uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_open uuid;v_ids bigint[]:='{}';v_id bigint;v_pos public.player_position;v_need int;v_pool text;
begin
  select l.player_pool into v_pool from public.league_members m join public.leagues l on l.id=m.league_id where m.league_id=p_league_id and m.user_id=v_user and l.game_format='pack';
  if v_pool is null then raise exception 'Pack League membership required';end if;
  if exists(select 1 from public.pack_cards where league_id=p_league_id and user_id=v_user) then raise exception 'Starter bundle already claimed';end if;
  insert into public.pack_openings(league_id,user_id,pack_type) values(p_league_id,v_user,'starter') returning id into v_open;
  select id into v_id from public.players where active and is_club_captain and (v_pool='All Top Five' or competition=v_pool) order by case when v_pool='All Top Five' and full_name='Virgil van Dijk' then 0 else 1 end,random() limit 1;
  if v_id is null then raise exception 'Captain pool is not ready';end if;
  insert into public.pack_cards(league_id,user_id,player_id,acquired_via,opening_id) values(p_league_id,v_user,v_id,'starter_captain',v_open);v_ids:=array_append(v_ids,v_id);
  select id into v_id from public.players where active and draft_rank<=50 and not(id=any(v_ids)) and (v_pool='All Top Five' or competition=v_pool) order by case when v_pool='All Top Five' and full_name='Erling Haaland' then 0 else 1 end,random() limit 1;
  if v_id is null then raise exception 'Superstar pool is not ready';end if;
  insert into public.pack_cards(league_id,user_id,player_id,acquired_via,opening_id) values(p_league_id,v_user,v_id,'starter_superstar',v_open);v_ids:=array_append(v_ids,v_id);
  foreach v_pos in array array['GK','DEF','MID','FWD']::public.player_position[] loop
    v_need:=case v_pos when 'GK' then 2 when 'DEF' then 6 when 'MID' then 6 else 4 end;
    for v_id in select id from public.players where active and position=v_pos and not(id=any(v_ids)) and (v_pool='All Top Five' or competition=v_pool) order by random() limit v_need loop
      insert into public.pack_cards(league_id,user_id,player_id,acquired_via,opening_id) values(p_league_id,v_user,v_id,'starter_regular',v_open);v_ids:=array_append(v_ids,v_id);
    end loop;
  end loop;
  while cardinality(v_ids)<22 loop
    select id into v_id from public.players where active and not(id=any(v_ids)) and (v_pool='All Top Five' or competition=v_pool) order by random() limit 1;
    if v_id is null then raise exception 'This player pool does not contain enough active players';end if;
    insert into public.pack_cards(league_id,user_id,player_id,acquired_via,opening_id) values(p_league_id,v_user,v_id,'starter_regular',v_open);v_ids:=array_append(v_ids,v_id);
  end loop;
  update public.pack_wallets set coins=500,updated_at=now() where league_id=p_league_id and user_id=v_user;
  return cardinality(v_ids);
end$$;

create or replace function public.open_pack(p_league_id uuid,p_pack_type text) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_cost int;v_count int;v_open uuid;v_id bigint;v_pos public.player_position;v_super boolean:=false;v_existing int;v_pool text;
begin
  if p_pack_type not in('regular','position_gk','position_def','position_mid','position_fwd','captain','superstar') then raise exception 'Invalid pack type';end if;
  select l.player_pool into v_pool from public.league_members m join public.leagues l on l.id=m.league_id where m.league_id=p_league_id and m.user_id=v_user and l.game_format='pack';
  if v_pool is null then raise exception 'Pack League membership required';end if;
  v_cost:=case when p_pack_type='regular' then 500 when p_pack_type like 'position_%' then 750 when p_pack_type='captain' then 1000 else 1500 end;
  v_count:=case when p_pack_type='regular' then 5 when p_pack_type like 'position_%' then 3 else 1 end;
  select count(*) into v_existing from public.pack_cards where league_id=p_league_id and user_id=v_user;
  if v_existing+v_count>50 then raise exception 'Not enough collection space';end if;
  update public.pack_wallets set coins=coins-v_cost,updated_at=now() where league_id=p_league_id and user_id=v_user and coins>=v_cost;if not found then raise exception 'Not enough coins';end if;
  insert into public.pack_openings(league_id,user_id,pack_type,coin_cost) values(p_league_id,v_user,p_pack_type,v_cost) returning id into v_open;
  if p_pack_type='regular' then v_super:=random()<0.05;end if;
  for i in 1..v_count loop
    v_pos:=case p_pack_type when 'position_gk' then 'GK'::public.player_position when 'position_def' then 'DEF'::public.player_position when 'position_mid' then 'MID'::public.player_position when 'position_fwd' then 'FWD'::public.player_position else null end;
    select id into v_id from public.players where active and (v_pool='All Top Five' or competition=v_pool) and (v_pos is null or position=v_pos)
      and (p_pack_type<>'captain' or is_club_captain) and (p_pack_type<>'superstar' or draft_rank<=50)
      and (p_pack_type<>'regular' or (case when v_super and i=1 then draft_rank<=50 else draft_rank>50 or draft_rank is null end)) order by random() limit 1;
    if v_id is null then raise exception 'No eligible player exists in this league pool for that pack';end if;
    insert into public.pack_cards(league_id,user_id,player_id,acquired_via,opening_id) values(p_league_id,v_user,v_id,case when p_pack_type='regular' then 'regular_pack' when p_pack_type like 'position_%' then 'position_pack' when p_pack_type='captain' then 'captain_pack' else 'superstar_pack' end,v_open);
  end loop;
  return v_open;
end$$;

revoke all on function public.create_league(text,text,smallint,smallint,boolean,smallint,text,text,text),public.my_leagues(),public.league_settings(uuid),public.claim_pack_starter(uuid),public.open_pack(uuid,text) from public,anon;
grant execute on function public.create_league(text,text,smallint,smallint,boolean,smallint,text,text,text),public.my_leagues(),public.league_settings(uuid),public.claim_pack_starter(uuid),public.open_pack(uuid,text) to authenticated;
revoke all on function public.prevent_player_pool_change(),private.player_in_league_pool(uuid,bigint),private.enforce_league_player_pool(),private.enforce_waiver_player_pool() from public,anon,authenticated;

comment on column public.leagues.player_pool is 'Season-locked eligible player competition, or All Top Five.';
