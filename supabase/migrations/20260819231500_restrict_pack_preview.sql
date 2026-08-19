create or replace function public.create_league(
  p_name text,p_team_name text,p_size smallint,p_draft_pick_seconds smallint,p_trades_enabled boolean,
  p_lineup_lock_minutes smallint,p_game_format text,p_calendar_competition text,p_player_pool text,
  p_auction_style text default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_id uuid;v_code text;v_calendar text;
begin
  if v_user is null then raise exception 'Authentication required';end if;
  if p_game_format='pack' and not exists(select 1 from auth.users where id=v_user and lower(email)='carloshernandezave256@gmail.com') then raise exception 'Pack Leagues are coming soon';end if;
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
  perform private.copy_cached_league_fixtures(v_id);
  return v_id;
end$$;

create or replace function public.join_league(p_invite_code text,p_team_name text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_league public.leagues%rowtype;v_count int;
begin
  if v_user is null then raise exception 'Authentication required';end if;
  select * into v_league from public.leagues where invite_code=upper(trim(p_invite_code)) for update;
  if not found then raise exception 'Invite code not found';end if;
  if v_league.game_format='pack' and not exists(select 1 from auth.users where id=v_user and lower(email)='carloshernandezave256@gmail.com') then raise exception 'Pack Leagues are coming soon';end if;
  if exists(select 1 from public.league_members where league_id=v_league.id and user_id=v_user) then raise exception 'You already belong to this league';end if;
  if not v_league.joining_open then raise exception 'This league is no longer accepting managers';end if;
  if v_league.game_format='draft' and exists(select 1 from public.drafts where league_id=v_league.id) then raise exception 'This league draft has already started';end if;
  select count(*) into v_count from public.league_members where league_id=v_league.id;
  if v_count>=v_league.size then raise exception 'League is full';end if;
  insert into public.league_members(league_id,user_id,team_name,draft_slot,waiver_priority)
  values(v_league.id,v_user,trim(p_team_name),v_count+1,v_count+1);
  if v_league.game_format='pack' then insert into public.pack_wallets(league_id,user_id) values(v_league.id,v_user);end if;
  return v_league.id;
end$$;

revoke all on function public.create_league(text,text,smallint,smallint,boolean,smallint,text,text,text,text) from public,anon;
grant execute on function public.create_league(text,text,smallint,smallint,boolean,smallint,text,text,text,text) to authenticated;
revoke all on function public.join_league(text,text) from public,anon;
grant execute on function public.join_league(text,text) to authenticated;
