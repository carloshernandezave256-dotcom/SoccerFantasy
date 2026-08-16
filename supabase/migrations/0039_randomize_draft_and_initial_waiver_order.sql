-- Joining order is only temporary. A fresh snake-draft order is generated
-- when the commissioner starts the draft.
create or replace function public.start_draft(
  p_league_id uuid,
  p_pick_seconds smallint default 90
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_count integer;
  v_id uuid;
  v_status public.draft_status;
  v_seconds smallint;
begin
  select draft_pick_seconds into v_seconds
  from public.leagues
  where id=p_league_id and commissioner_id=v_user and game_format='draft'
  for update;
  if not found then raise exception 'Only the commissioner can start this Draft League';end if;

  select id,status into v_id,v_status from public.drafts where league_id=p_league_id for update;
  if found then
    if v_status='live' then return v_id;end if;
    raise exception 'This draft already exists with status %',v_status;
  end if;

  select count(*) into v_count from public.league_members where league_id=p_league_id;
  if v_count<3 then raise exception 'At least 3 managers are required before drafting';end if;

  -- Clear first to avoid collisions with the unique (league_id,draft_slot)
  -- constraint while the randomized positions are assigned.
  update public.league_members set draft_slot=null where league_id=p_league_id;
  with randomized as (
    select user_id,row_number() over(order by random())::smallint as slot
    from public.league_members where league_id=p_league_id
  )
  update public.league_members m set draft_slot=r.slot
  from randomized r
  where m.league_id=p_league_id and m.user_id=r.user_id;

  update public.leagues set joining_open=false where id=p_league_id;
  insert into public.drafts(league_id,status,pick_seconds,current_pick,pick_deadline,started_at)
  values(p_league_id,'live',v_seconds,1,now()+make_interval(secs=>v_seconds),now())
  returning id into v_id;
  return v_id;
end
$$;

-- The initial waiver order is independent of draft order. Generate it once,
-- immediately after the last manual or automatic draft pick completes the draft.
create or replace function private.randomize_initial_waiver_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status is distinct from new.status and new.status='complete' then
    with randomized as (
      select user_id,row_number() over(order by random())::integer as priority
      from public.league_members where league_id=new.league_id
    )
    update public.league_members m set waiver_priority=r.priority
    from randomized r
    where m.league_id=new.league_id and m.user_id=r.user_id;
  end if;
  return new;
end
$$;

drop trigger if exists randomize_initial_waiver_order on public.drafts;
create trigger randomize_initial_waiver_order
after update of status on public.drafts
for each row execute function private.randomize_initial_waiver_order();

revoke all on function public.start_draft(uuid,smallint) from public,anon;
grant execute on function public.start_draft(uuid,smallint) to authenticated;
revoke all on function private.randomize_initial_waiver_order() from public,anon,authenticated;
