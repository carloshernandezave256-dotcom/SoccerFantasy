create or replace function public.save_pitch_order(p_league_id uuid,p_starters bigint[])
returns void language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_lock timestamptz;v_existing integer;v_matched integer;
begin
  if v_user is null then raise exception 'Authentication required';end if;
  if not exists(select 1 from public.league_members where league_id=p_league_id and user_id=v_user) then raise exception 'League membership required';end if;
  select roster_lock_at into v_lock from public.league_transaction_windows where league_id=p_league_id order by gameweek desc limit 1;
  if v_lock is not null and now()>=v_lock then raise exception 'Lineup changes are locked because this matchweek has started';end if;
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
declare v_user uuid:=(select auth.uid());v_lock timestamptz;
begin
  if v_user is null then raise exception 'Authentication required';end if;
  if not exists(select 1 from public.league_members where league_id=p_league_id and user_id=v_user) then raise exception 'League membership required';end if;
  select roster_lock_at into v_lock from public.league_transaction_windows where league_id=p_league_id order by gameweek desc limit 1;
  if v_lock is not null and now()>=v_lock then raise exception 'Lineup changes are locked because this matchweek has started';end if;
  if not exists(select 1 from public.lineup_players where league_id=p_league_id and user_id=v_user and player_id=p_captain and is_starter) then raise exception 'Your captain must be in the starting eleven';end if;
  update public.lineup_players set is_captain=false where league_id=p_league_id and user_id=v_user and is_captain;
  update public.lineup_players set is_captain=true where league_id=p_league_id and user_id=v_user and player_id=p_captain and is_starter;
end$$;

revoke all on function public.save_pitch_order(uuid,bigint[]),public.set_lineup_captain(uuid,bigint) from public,anon;
grant execute on function public.save_pitch_order(uuid,bigint[]),public.set_lineup_captain(uuid,bigint) to authenticated;
