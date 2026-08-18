begin;

create or replace function private.lineup_changes_locked(p_league_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  with current_window as (
    select w.gameweek,w.roster_lock_at
    from public.league_transaction_windows w
    where w.league_id=p_league_id
    order by w.gameweek desc limit 1
  )
  select coalesce((
    select case
      when now()<w.roster_lock_at then false
      when exists(
        select 1 from public.league_headline_fixtures f
        where f.league_id=p_league_id and f.gameweek=w.gameweek
      ) then exists(
        select 1 from public.league_headline_fixtures f
        where f.league_id=p_league_id and f.gameweek=w.gameweek
          and upper(f.status) not in ('FT','AET','PEN')
      )
      else true
    end
    from current_window w
  ),false)
$$;

revoke all on function private.lineup_changes_locked(uuid) from public,anon,authenticated;

create or replace function public.lineup_lock_state(p_league_id uuid)
returns table(gameweek integer,locks_at timestamptz,reopens_after timestamptz,locked boolean)
language plpgsql stable security definer set search_path='' as $$
begin
  if not exists(select 1 from public.league_members where league_id=p_league_id and user_id=(select auth.uid())) then
    raise exception 'League membership required';
  end if;
  return query
  select w.gameweek,w.roster_lock_at,max(f.kickoff),private.lineup_changes_locked(p_league_id)
  from public.league_transaction_windows w
  left join public.league_headline_fixtures f on f.league_id=w.league_id and f.gameweek=w.gameweek
  where w.league_id=p_league_id
  group by w.gameweek,w.roster_lock_at
  order by w.gameweek desc limit 1;
end$$;

revoke all on function public.lineup_lock_state(uuid) from public,anon;
grant execute on function public.lineup_lock_state(uuid) to authenticated;

create or replace function public.save_lineup(p_league_id uuid,p_starters bigint[],p_bench bigint[],p_captain bigint)
returns void language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_gk int;v_def int;v_mid int;v_fwd int;v_owned int;v_format text;
begin
  select l.game_format into v_format from public.league_members m join public.leagues l on l.id=m.league_id where m.league_id=p_league_id and m.user_id=v_user;
  if v_format is null then raise exception 'League membership required';end if;
  if private.lineup_changes_locked(p_league_id) then raise exception 'Your full lineup is locked until every fixture in this gameweek is final';end if;
  if cardinality(p_starters)<>11 then raise exception 'A starting lineup requires exactly 11 players';end if;
  if cardinality(p_bench)>7 then raise exception 'The bench allows at most 7 players';end if;
  if not p_captain=any(p_starters) then raise exception 'Your captain must be in the starting XI';end if;
  if cardinality(p_starters||p_bench)<>cardinality(array(select distinct unnest(p_starters||p_bench))) then raise exception 'A player cannot occupy two lineup slots';end if;
  if v_format='pack' then select count(distinct player_id) into v_owned from public.pack_cards where league_id=p_league_id and user_id=v_user and active_slot is not null and player_id=any(p_starters||p_bench);
  else select count(*) into v_owned from public.draft_picks where league_id=p_league_id and user_id=v_user and player_id=any(p_starters||p_bench);end if;
  if v_owned<>cardinality(p_starters||p_bench) then raise exception 'Every lineup player must be in your active squad';end if;
  select count(*) filter(where position='GK'),count(*) filter(where position='DEF'),count(*) filter(where position='MID'),count(*) filter(where position='FWD') into v_gk,v_def,v_mid,v_fwd from public.players where id=any(p_starters);
  if v_gk<>1 then raise exception 'Starting XI requires exactly one goalkeeper';end if;
  if v_def<3 then raise exception 'Starting XI requires at least three defenders';end if;
  if v_mid<1 or v_fwd<1 then raise exception 'Starting XI requires at least one midfielder and one forward';end if;
  if v_fwd>4 then raise exception 'Starting XI allows at most four forwards';end if;
  delete from public.lineup_players where league_id=p_league_id and user_id=v_user;
  insert into public.lineup_players(league_id,user_id,player_id,is_starter,is_captain,pitch_order)
    select p_league_id,v_user,x,true,x=p_captain,ord from unnest(p_starters) with ordinality s(x,ord);
  insert into public.lineup_players(league_id,user_id,player_id,is_starter,bench_order,is_captain)
    select p_league_id,v_user,x,false,ord,false from unnest(p_bench) with ordinality b(x,ord);
end$$;

create or replace function public.initialize_default_lineup(p_league_id uuid,p_starters bigint[],p_bench bigint[])
returns boolean language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_format text;v_gk integer;v_def integer;v_mid integer;v_fwd integer;v_existing integer;v_owned integer;
begin
  if v_user is null then raise exception 'Authentication required';end if;
  select l.game_format into v_format from public.league_members m join public.leagues l on l.id=m.league_id where m.league_id=p_league_id and m.user_id=v_user;
  if v_format is null then raise exception 'League membership required';end if;
  if private.lineup_changes_locked(p_league_id) then raise exception 'Your full lineup is locked until every fixture in this gameweek is final';end if;
  select count(*) filter(where lp.is_starter),count(*) filter(where lp.is_starter and p.position='GK'),count(*) filter(where lp.is_starter and p.position='DEF'),count(*) filter(where lp.is_starter and p.position='MID'),count(*) filter(where lp.is_starter and p.position='FWD')
  into v_existing,v_gk,v_def,v_mid,v_fwd from public.lineup_players lp join public.players p on p.id=lp.player_id where lp.league_id=p_league_id and lp.user_id=v_user;
  if v_existing=11 and v_gk=1 and v_def>=3 and v_mid>=1 and v_fwd between 1 and 4 then return false;end if;
  if cardinality(p_starters)<>11 or cardinality(p_bench)>7 then raise exception 'Default lineup requires 11 starters and at most 7 bench players';end if;
  if cardinality(p_starters||p_bench)<>cardinality(array(select distinct unnest(p_starters||p_bench))) then raise exception 'A player cannot occupy two lineup slots';end if;
  select count(*) filter(where position='GK'),count(*) filter(where position='DEF'),count(*) filter(where position='MID'),count(*) filter(where position='FWD') into v_gk,v_def,v_mid,v_fwd from public.players where id=any(p_starters);
  if v_gk<>1 or v_def<>4 or v_mid<>3 or v_fwd<>3 then raise exception 'The automatic lineup must be a 4-3-3 with exactly one goalkeeper';end if;
  if v_format='pack' then select count(distinct player_id) into v_owned from public.pack_cards where league_id=p_league_id and user_id=v_user and active_slot is not null and player_id=any(p_starters||p_bench);
  else select count(*) into v_owned from public.draft_picks where league_id=p_league_id and user_id=v_user and player_id=any(p_starters||p_bench);end if;
  if v_owned<>cardinality(p_starters||p_bench) then raise exception 'Every default lineup player must be in your active squad';end if;
  delete from public.lineup_players where league_id=p_league_id and user_id=v_user;
  insert into public.lineup_players(league_id,user_id,player_id,is_starter,is_captain,pitch_order) select p_league_id,v_user,x,true,false,ord from unnest(p_starters) with ordinality s(x,ord);
  insert into public.lineup_players(league_id,user_id,player_id,is_starter,is_captain,bench_order) select p_league_id,v_user,x,false,false,ord from unnest(p_bench) with ordinality b(x,ord);
  return true;
end$$;

revoke all on function public.save_lineup(uuid,bigint[],bigint[],bigint),public.initialize_default_lineup(uuid,bigint[],bigint[]) from public,anon;
grant execute on function public.save_lineup(uuid,bigint[],bigint[],bigint),public.initialize_default_lineup(uuid,bigint[],bigint[]) to authenticated;

create or replace function public.save_pitch_order(p_league_id uuid,p_starters bigint[])
returns void language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_existing integer;v_matched integer;
begin
  if v_user is null then raise exception 'Authentication required';end if;
  if not exists(select 1 from public.league_members where league_id=p_league_id and user_id=v_user) then raise exception 'League membership required';end if;
  if private.lineup_changes_locked(p_league_id) then raise exception 'Your full lineup is locked until every fixture in this gameweek is final';end if;
  if cardinality(p_starters)<>11 or cardinality(p_starters)<>cardinality(array(select distinct unnest(p_starters))) then raise exception 'Pitch order requires 11 unique starters';end if;
  select count(*) filter(where is_starter),count(*) filter(where is_starter and player_id=any(p_starters)) into v_existing,v_matched
  from public.lineup_players where league_id=p_league_id and user_id=v_user;
  if v_existing<>11 or v_matched<>11 then raise exception 'Pitch order must contain your saved starting eleven';end if;
  update public.lineup_players set pitch_order=null where league_id=p_league_id and user_id=v_user and is_starter;
  update public.lineup_players lp set pitch_order=s.ord
  from unnest(p_starters) with ordinality s(player_id,ord)
  where lp.league_id=p_league_id and lp.user_id=v_user and lp.player_id=s.player_id and lp.is_starter;
end$$;

create or replace function public.set_lineup_captain(p_league_id uuid,p_captain bigint)
returns void language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());
begin
  if v_user is null then raise exception 'Authentication required';end if;
  if not exists(select 1 from public.league_members where league_id=p_league_id and user_id=v_user) then raise exception 'League membership required';end if;
  if private.lineup_changes_locked(p_league_id) then raise exception 'Your full lineup is locked until every fixture in this gameweek is final';end if;
  if not exists(select 1 from public.lineup_players where league_id=p_league_id and user_id=v_user and player_id=p_captain and is_starter) then raise exception 'Your captain must be in the starting eleven';end if;
  update public.lineup_players set is_captain=false where league_id=p_league_id and user_id=v_user and is_captain;
  update public.lineup_players set is_captain=true where league_id=p_league_id and user_id=v_user and player_id=p_captain and is_starter;
end$$;

create or replace function public.save_partial_pitch_order(p_league_id uuid,p_players bigint[])
returns void language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_format text;v_owned integer;
begin
  if v_user is null then raise exception 'Authentication required';end if;
  if cardinality(p_players)<1 or cardinality(p_players)>11 or cardinality(p_players)<>cardinality(array(select distinct unnest(p_players))) then raise exception 'Pitch order requires 1 to 11 unique players';end if;
  select l.game_format into v_format from public.league_members m join public.leagues l on l.id=m.league_id where m.league_id=p_league_id and m.user_id=v_user;
  if v_format is null then raise exception 'League membership required';end if;
  if private.lineup_changes_locked(p_league_id) then raise exception 'Your full lineup is locked until every fixture in this gameweek is final';end if;
  if v_format='pack' then
    select count(distinct player_id) into v_owned from public.pack_cards where league_id=p_league_id and user_id=v_user and active_slot is not null and player_id=any(p_players);
  else
    select count(*) into v_owned from public.draft_picks where league_id=p_league_id and user_id=v_user and player_id=any(p_players);
  end if;
  if v_owned<>cardinality(p_players) then raise exception 'Every arranged player must be in your active roster';end if;
  update public.lineup_players set pitch_order=null where league_id=p_league_id and user_id=v_user;
  insert into public.lineup_players(league_id,user_id,player_id,is_starter,is_captain,bench_order,pitch_order)
  select p_league_id,v_user,x,true,false,null,ord from unnest(p_players) with ordinality s(x,ord)
  on conflict(league_id,user_id,player_id) do update set is_starter=true,bench_order=null,pitch_order=excluded.pitch_order,updated_at=now();
end$$;

revoke all on function public.save_pitch_order(uuid,bigint[]),public.set_lineup_captain(uuid,bigint),public.save_partial_pitch_order(uuid,bigint[]) from public,anon;
grant execute on function public.save_pitch_order(uuid,bigint[]),public.set_lineup_captain(uuid,bigint),public.save_partial_pitch_order(uuid,bigint[]) to authenticated;

commit;
