-- Beta support: allow a commissioner to start and test an Auction League alone.
create or replace function public.start_auction(p_league_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_user uuid := (select auth.uid());
  v_league public.leagues%rowtype;
  v_members integer;
  v_draft uuid;
  v_session uuid;
begin
  select * into v_league
  from public.leagues
  where id=p_league_id and commissioner_id=v_user and game_format='auction'
  for update;
  if not found then
    raise exception 'Only the Auction League commissioner can start this auction';
  end if;
  if exists(select 1 from public.auction_sessions where league_id=p_league_id) then
    raise exception 'Auction already started';
  end if;
  select count(*) into v_members
  from public.league_members
  where league_id=p_league_id;
  if v_members<1 then
    raise exception 'At least 1 manager is required';
  end if;
  with randomized as(
    select user_id,row_number() over(order by random())::smallint slot
    from public.league_members where league_id=p_league_id
  )
  update public.league_members m set draft_slot=r.slot
  from randomized r
  where m.league_id=p_league_id and m.user_id=r.user_id;
  insert into public.drafts(league_id,status,pick_seconds,current_pick,pick_deadline,started_at)
  values(p_league_id,'live',20,1,null,now()) returning id into v_draft;
  insert into public.auction_sessions(league_id,draft_id,style,status,current_nominator_slot)
  values(
    p_league_id,v_draft,v_league.auction_style,
    case when v_league.auction_style='nomination' then 'nomination' else 'reveal' end,1
  ) returning id into v_session;
  insert into public.auction_budgets(league_id,user_id,remaining_budget)
  select p_league_id,user_id,2000000000
  from public.league_members where league_id=p_league_id;
  update public.leagues set joining_open=false where id=p_league_id;
  return v_session;
end$$;

revoke all on function public.start_auction(uuid) from public,anon;
grant execute on function public.start_auction(uuid) to authenticated;
