-- A league creator is also its first member and therefore starts first in
-- the initial waiver order. The player-pool create_league replacement in
-- 0036 omitted this required column.
create or replace function public.create_league(
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
  insert into public.league_members(league_id,user_id,team_name,role,draft_slot,waiver_priority)
  values(v_id,v_user,trim(p_team_name),'commissioner',1,1);
  if p_game_format='pack' then insert into public.pack_wallets(league_id,user_id) values(v_id,v_user);end if;
  return v_id;
end$$;

revoke all on function public.create_league(text,text,smallint,smallint,boolean,smallint,text,text,text) from public,anon;
grant execute on function public.create_league(text,text,smallint,smallint,boolean,smallint,text,text,text) to authenticated;
