alter table public.league_members
  add column if not exists draft_ready_at timestamptz;

create or replace function public.set_draft_ready(p_league_id uuid,p_ready boolean)
returns void language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());
begin
  if v_user is null then raise exception 'Authentication required';end if;
  if exists(select 1 from public.drafts where league_id=p_league_id) then
    raise exception 'Draft readiness is locked after the draft starts';
  end if;
  update public.league_members
  set draft_ready_at=case when p_ready then now() else null end
  where league_id=p_league_id and user_id=v_user;
  if not found then raise exception 'League membership required';end if;
end$$;
revoke all on function public.set_draft_ready(uuid,boolean) from public,anon;
grant execute on function public.set_draft_ready(uuid,boolean) to authenticated;

create or replace function public.draft_lobby_status(p_league_id uuid)
returns table(
  league_size smallint,manager_count integer,ready_count integer,
  is_commissioner boolean,my_ready boolean,player_pool text,gk_count integer,def_count integer,
  mid_count integer,fwd_count integer,club_count integer
) language plpgsql security definer set search_path='' stable as $$
declare v_user uuid:=(select auth.uid());
begin
  if not exists(select 1 from public.league_members where league_id=p_league_id and user_id=v_user) then
    raise exception 'League membership required';
  end if;
  return query
  select l.size,
    (select count(*)::integer from public.league_members m where m.league_id=l.id),
    (select count(*)::integer from public.league_members m where m.league_id=l.id and m.draft_ready_at is not null),
    l.commissioner_id=v_user,
    exists(select 1 from public.league_members me where me.league_id=l.id and me.user_id=v_user and me.draft_ready_at is not null),
    l.player_pool,
    count(*) filter(where p.position='GK')::integer,
    count(*) filter(where p.position='DEF')::integer,
    count(*) filter(where p.position='MID')::integer,
    count(*) filter(where p.position='FWD')::integer,
    count(distinct p.club)::integer
  from public.leagues l
  left join public.players p on p.active and (l.player_pool='All Top Five' or p.competition=l.player_pool)
  where l.id=p_league_id group by l.id;
end$$;
revoke all on function public.draft_lobby_status(uuid) from public,anon;
grant execute on function public.draft_lobby_status(uuid) to authenticated;

drop function if exists public.start_draft(uuid,smallint);
create function public.start_draft(p_league_id uuid,p_pick_seconds smallint default 90,p_force_start boolean default false)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_user uuid:=(select auth.uid());v_count integer;v_size smallint;v_ready integer;
  v_id uuid;v_status public.draft_status;v_seconds smallint;v_pool text;
  v_gk integer;v_def integer;v_mid integer;v_fwd integer;v_clubs integer;
begin
  select size,draft_pick_seconds,player_pool into v_size,v_seconds,v_pool
  from public.leagues where id=p_league_id and commissioner_id=v_user and game_format='draft' for update;
  if not found then raise exception 'Only the commissioner can start this Draft League';end if;
  select id,status into v_id,v_status from public.drafts where league_id=p_league_id for update;
  if found then
    if v_status='live' then return v_id;end if;
    raise exception 'This draft already exists with status %',v_status;
  end if;
  select count(*),count(*) filter(where draft_ready_at is not null) into v_count,v_ready
  from public.league_members where league_id=p_league_id;
  if v_count<3 then raise exception 'At least 3 managers are required before drafting';end if;
  if not p_force_start and v_count<v_size then
    raise exception 'Only % of % managers have joined. Confirm Start Early to close the remaining places',v_count,v_size;
  end if;
  if not p_force_start and v_ready<v_count then
    raise exception '% manager(s) have not marked themselves ready',v_count-v_ready;
  end if;
  select count(*) filter(where position='GK'),count(*) filter(where position='DEF'),
    count(*) filter(where position='MID'),count(*) filter(where position='FWD'),count(distinct club)
  into v_gk,v_def,v_mid,v_fwd,v_clubs from public.players
  where active and (v_pool='All Top Five' or competition=v_pool);
  if v_gk<v_count*2 or v_def<v_count*6 or v_mid<v_count*5 or v_fwd<v_count*5 or v_clubs<5 then
    raise exception 'Player pool cannot complete % rosters (need % GK, % DEF, % MID, % FWD and at least 5 clubs; found %, %, %, %, %)',
      v_count,v_count*2,v_count*6,v_count*5,v_count*5,v_gk,v_def,v_mid,v_fwd,v_clubs;
  end if;
  update public.league_members set draft_slot=null where league_id=p_league_id;
  with randomized as(
    select user_id,row_number() over(order by random())::smallint slot
    from public.league_members where league_id=p_league_id
  ) update public.league_members m set draft_slot=r.slot from randomized r
    where m.league_id=p_league_id and m.user_id=r.user_id;
  update public.leagues set joining_open=false where id=p_league_id;
  insert into public.drafts(league_id,status,pick_seconds,current_pick,pick_deadline,started_at)
  values(p_league_id,'live',v_seconds,1,now()+make_interval(secs=>v_seconds),now()) returning id into v_id;
  return v_id;
end$$;
revoke all on function public.start_draft(uuid,smallint,boolean) from public,anon;
grant execute on function public.start_draft(uuid,smallint,boolean) to authenticated;

create or replace function private.perform_auto_pick(p_league_id uuid)
returns bigint language plpgsql security definer set search_path='' as $$
declare
  v_draft public.drafts%rowtype;v_n integer;v_round integer;v_index integer;
  v_slot integer;v_user uuid;v_player bigint;v_id bigint;
begin
  select * into v_draft from public.drafts where league_id=p_league_id for update;
  if not found or v_draft.status<>'live' then raise exception 'Draft is not live';end if;
  if v_draft.pick_deadline is null or now()<=v_draft.pick_deadline then raise exception 'Auto-pick is not due';end if;
  select count(*) into v_n from public.league_members where league_id=p_league_id;
  v_round:=((v_draft.current_pick-1)/v_n)+1;v_index:=((v_draft.current_pick-1)%v_n)+1;
  v_slot:=case when mod(v_round,2)=1 then v_index else v_n-v_index+1 end;
  select user_id into v_user from public.league_members where league_id=p_league_id and draft_slot=v_slot;
  select p.id into v_player from public.draft_queue q join public.players p on p.id=q.player_id
  where q.league_id=p_league_id and q.user_id=v_user
    and private.player_in_league_pool(p_league_id,p.id)
    and private.draft_pick_is_valid(p_league_id,v_user,p.id)
  order by q.priority limit 1;
  if v_player is null then
    select p.id into v_player from public.players p
    where private.player_in_league_pool(p_league_id,p.id)
      and private.draft_pick_is_valid(p_league_id,v_user,p.id)
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
end$$;
revoke all on function private.perform_auto_pick(uuid) from public,anon,authenticated;

create or replace function public.resume_paused_draft(p_league_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_draft public.drafts%rowtype;
begin
  if not exists(select 1 from public.leagues where id=p_league_id and commissioner_id=v_user) then
    raise exception 'Only the commissioner can resume this draft';
  end if;
  select * into v_draft from public.drafts where league_id=p_league_id for update;
  if not found or v_draft.status<>'paused' then raise exception 'This draft is not paused';end if;
  update public.drafts set status='live',pick_deadline=now()+make_interval(secs=>pick_seconds),updated_at=now()
  where id=v_draft.id;
end$$;
revoke all on function public.resume_paused_draft(uuid) from public,anon;
grant execute on function public.resume_paused_draft(uuid) to authenticated;

create or replace function public.set_draft_queue(p_league_id uuid,p_player_ids bigint[])
returns void language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_count integer:=coalesce(cardinality(p_player_ids),0);v_valid integer;
begin
  if v_user is null then raise exception 'Authentication required';end if;
  if not exists(select 1 from public.league_members where league_id=p_league_id and user_id=v_user) then raise exception 'League membership required';end if;
  if exists(select 1 from public.drafts where league_id=p_league_id and status in('paused','complete')) then raise exception 'Draft queue is closed';end if;
  if v_count>25 then raise exception 'Your draft queue can contain at most 25 players';end if;
  if v_count<>(select count(distinct item) from unnest(coalesce(p_player_ids,'{}'::bigint[])) item) then raise exception 'A player can only appear once in your queue';end if;
  select count(*) into v_valid from public.players p where p.id=any(coalesce(p_player_ids,'{}'::bigint[]))
    and private.player_in_league_pool(p_league_id,p.id)
    and not exists(select 1 from public.draft_picks dp where dp.league_id=p_league_id and dp.player_id=p.id);
  if v_valid<>v_count then raise exception 'Every queued player must be active, available and inside this league pool';end if;
  delete from public.draft_queue where league_id=p_league_id and user_id=v_user;
  insert into public.draft_queue(league_id,user_id,player_id,priority)
  select p_league_id,v_user,item,ordinality::smallint from unnest(coalesce(p_player_ids,'{}'::bigint[])) with ordinality queued(item,ordinality);
end$$;
revoke all on function public.set_draft_queue(uuid,bigint[]) from public,anon;
grant execute on function public.set_draft_queue(uuid,bigint[]) to authenticated;
