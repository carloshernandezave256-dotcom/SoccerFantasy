create or replace function public.start_draft(
  p_league_id uuid,
  p_pick_seconds smallint default 60
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
begin
  perform 1
  from public.leagues
  where id = p_league_id
    and commissioner_id = v_user
  for update;

  if not found then
    raise exception 'Only the commissioner can start this draft';
  end if;

  select id, status
  into v_id, v_status
  from public.drafts
  where league_id = p_league_id
  for update;

  if found then
    if v_status = 'live' then
      return v_id;
    end if;
    raise exception 'This draft already exists with status %', v_status;
  end if;

  select count(*)
  into v_count
  from public.league_members
  where league_id = p_league_id;

  if v_count < 3 then
    raise exception 'At least 3 managers are required before drafting';
  end if;

  insert into public.drafts(
    league_id,
    status,
    pick_seconds,
    current_pick,
    pick_deadline,
    started_at
  ) values (
    p_league_id,
    'live',
    p_pick_seconds,
    1,
    now() + make_interval(secs => p_pick_seconds),
    now()
  )
  returning id into v_id;

  return v_id;
end
$$;

revoke all on function public.start_draft(uuid, smallint) from public, anon;
grant execute on function public.start_draft(uuid, smallint) to authenticated;
