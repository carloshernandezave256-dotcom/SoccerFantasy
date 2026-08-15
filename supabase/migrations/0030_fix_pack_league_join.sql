create or replace function public.join_league(p_invite_code text,p_team_name text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_league public.leagues%rowtype;v_count int;
begin
  if v_user is null then raise exception 'Authentication required';end if;
  select * into v_league from public.leagues where invite_code=upper(trim(p_invite_code)) for update;
  if not found then raise exception 'Invite code not found';end if;
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
revoke all on function public.join_league(text,text) from public,anon;
grant execute on function public.join_league(text,text) to authenticated;
