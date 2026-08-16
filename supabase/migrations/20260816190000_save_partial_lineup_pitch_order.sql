
drop function if exists public.save_partial_pitch_slot(uuid,bigint,smallint);
create or replace function public.save_partial_pitch_order(p_league_id uuid,p_players bigint[])
returns void language plpgsql security definer set search_path=''
as $f$
declare v_user uuid:=(select auth.uid());v_format text;v_lock timestamptz;v_owned integer;
begin
 if v_user is null then raise exception 'Authentication required';end if;
 if cardinality(p_players)<1 or cardinality(p_players)>11 or cardinality(p_players)<>cardinality(array(select distinct unnest(p_players))) then raise exception 'Pitch order requires 1 to 11 unique players';end if;
 select l.game_format into v_format from public.league_members m join public.leagues l on l.id=m.league_id where m.league_id=p_league_id and m.user_id=v_user;
 if v_format is null then raise exception 'League membership required';end if;
 select roster_lock_at into v_lock from public.league_transaction_windows where league_id=p_league_id order by gameweek desc limit 1;
 if v_lock is not null and now()>=v_lock then raise exception 'Lineup changes are locked because this matchweek has started';end if;
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
end$f$;
revoke all on function public.save_partial_pitch_order(uuid,bigint[]) from public,anon;
grant execute on function public.save_partial_pitch_order(uuid,bigint[]) to authenticated;
