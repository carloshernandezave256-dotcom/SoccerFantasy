create or replace function private.draft_pick_is_valid(
  p_league_id uuid,
  p_user_id uuid,
  p_player_id bigint
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player public.players%rowtype;
  v_total integer;
  v_gk integer;
  v_def integer;
  v_mid integer;
  v_fwd integer;
  v_club integer;
  v_remaining integer;
  v_missing integer;
begin
  select * into v_player from public.players where id = p_player_id and active;
  if not found then return false; end if;

  if exists(select 1 from public.draft_picks where league_id = p_league_id and player_id = p_player_id) then
    return false;
  end if;

  select
    count(*),
    count(*) filter(where p.position = 'GK'),
    count(*) filter(where p.position = 'DEF'),
    count(*) filter(where p.position = 'MID'),
    count(*) filter(where p.position = 'FWD'),
    count(*) filter(where p.club = v_player.club)
  into v_total,v_gk,v_def,v_mid,v_fwd,v_club
  from public.draft_picks dp
  join public.players p on p.id = dp.player_id
  where dp.league_id = p_league_id and dp.user_id = p_user_id;

  if v_total >= 18 or v_club >= 4 then return false; end if;
  if (v_player.position = 'GK' and v_gk >= 2)
    or (v_player.position = 'DEF' and v_def >= 6)
    or (v_player.position = 'MID' and v_mid >= 5)
    or (v_player.position = 'FWD' and v_fwd >= 5) then
    return false;
  end if;

  v_gk := v_gk + case when v_player.position = 'GK' then 1 else 0 end;
  v_def := v_def + case when v_player.position = 'DEF' then 1 else 0 end;
  v_mid := v_mid + case when v_player.position = 'MID' then 1 else 0 end;
  v_fwd := v_fwd + case when v_player.position = 'FWD' then 1 else 0 end;
  v_remaining := 18 - (v_total + 1);
  v_missing := greatest(0,2-v_gk) + greatest(0,6-v_def) + greatest(0,5-v_mid) + greatest(0,5-v_fwd);
  return v_missing <= v_remaining;
end
$$;

revoke all on function private.draft_pick_is_valid(uuid,uuid,bigint) from public,anon,authenticated;

create or replace function public.make_draft_pick(p_league_id uuid,p_player_id bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_draft public.drafts%rowtype;
  v_n integer;
  v_round integer;
  v_index integer;
  v_slot integer;
  v_on_clock uuid;
  v_pick_id bigint;
  v_player public.players%rowtype;
  v_club_count integer;
begin
  select * into v_draft from public.drafts where league_id=p_league_id for update;
  if not found or v_draft.status<>'live' then raise exception 'Draft is closed';end if;
  if now()>v_draft.pick_deadline then raise exception 'Pick timer expired';end if;
  select count(*) into v_n from public.league_members where league_id=p_league_id;
  v_round:=((v_draft.current_pick-1)/v_n)+1;
  v_index:=((v_draft.current_pick-1)%v_n)+1;
  v_slot:=case when mod(v_round,2)=1 then v_index else v_n-v_index+1 end;
  select user_id into v_on_clock from public.league_members where league_id=p_league_id and draft_slot=v_slot;
  if v_on_clock<>v_user then raise exception 'It is not your pick';end if;

  select * into v_player from public.players where id=p_player_id and active;
  if not found then raise exception 'That player is unavailable';end if;
  select count(*) into v_club_count
  from public.draft_picks dp join public.players p on p.id=dp.player_id
  where dp.league_id=p_league_id and dp.user_id=v_user and p.club=v_player.club;
  if v_club_count>=4 then raise exception 'You can draft at most 4 players from %',v_player.club;end if;
  if not private.draft_pick_is_valid(p_league_id,v_user,p_player_id) then
    raise exception 'That pick would break the required roster: 2 GK, 6 DEF, 5 MID and 5 FWD';
  end if;

  insert into public.draft_picks(draft_id,league_id,pick_number,round,user_id,player_id)
  values(v_draft.id,p_league_id,v_draft.current_pick,v_round,v_user,p_player_id)
  returning id into v_pick_id;
  update public.drafts set current_pick=current_pick+1,
    status=case when current_pick>=v_n*18 then 'complete'::public.draft_status else status end,
    pick_deadline=case when current_pick>=v_n*18 then null else now()+make_interval(secs=>pick_seconds) end,
    updated_at=now() where id=v_draft.id;
  return v_pick_id;
end
$$;

revoke all on function public.make_draft_pick(uuid,bigint) from public,anon;
grant execute on function public.make_draft_pick(uuid,bigint) to authenticated;

create or replace function private.perform_auto_pick(p_league_id uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_draft public.drafts%rowtype;
  v_n integer;
  v_round integer;
  v_index integer;
  v_slot integer;
  v_user uuid;
  v_player bigint;
  v_id bigint;
begin
  select * into v_draft from public.drafts where league_id=p_league_id for update;
  if not found or v_draft.status<>'live' then raise exception 'Draft is not live';end if;
  if v_draft.pick_deadline is null or now()<=v_draft.pick_deadline then raise exception 'Auto-pick is not due';end if;
  select count(*) into v_n from public.league_members where league_id=p_league_id;
  v_round:=((v_draft.current_pick-1)/v_n)+1;
  v_index:=((v_draft.current_pick-1)%v_n)+1;
  v_slot:=case when mod(v_round,2)=1 then v_index else v_n-v_index+1 end;
  select user_id into v_user from public.league_members where league_id=p_league_id and draft_slot=v_slot;

  select p.id into v_player
  from public.draft_queue q join public.players p on p.id=q.player_id
  where q.league_id=p_league_id and q.user_id=v_user
    and private.draft_pick_is_valid(p_league_id,v_user,p.id)
  order by q.priority limit 1;

  if v_player is null then
    select p.id into v_player from public.players p
    where p.active and private.draft_pick_is_valid(p_league_id,v_user,p.id)
    order by p.draft_rank nulls last,p.id limit 1;
  end if;
  if v_player is null then
    update public.drafts set status='paused',pick_deadline=null,updated_at=now() where id=v_draft.id;
    return null;
  end if;
  insert into public.draft_picks(draft_id,league_id,pick_number,round,user_id,player_id,auto_picked)
  values(v_draft.id,p_league_id,v_draft.current_pick,v_round,v_user,v_player,true) returning id into v_id;
  update public.drafts set current_pick=current_pick+1,
    status=case when current_pick>=v_n*18 then 'complete'::public.draft_status else status end,
    pick_deadline=case when current_pick>=v_n*18 then null else now()+make_interval(secs=>pick_seconds) end,
    updated_at=now() where id=v_draft.id;
  return v_id;
end
$$;

revoke all on function private.perform_auto_pick(uuid) from public,anon,authenticated;
