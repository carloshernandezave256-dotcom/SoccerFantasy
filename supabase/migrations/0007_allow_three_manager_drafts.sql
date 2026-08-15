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
  v_count int;
  v_id uuid;
begin
  perform 1
  from public.leagues
  where id = p_league_id
    and commissioner_id = v_user
  for update;

  if not found then
    raise exception 'Only the commissioner can start this draft';
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
  on conflict (league_id) do update
  set status = 'live',
      pick_seconds = p_pick_seconds,
      current_pick = 1,
      pick_deadline = now() + make_interval(secs => p_pick_seconds),
      started_at = now(),
      updated_at = now()
  returning id into v_id;

  return v_id;
end
$$;

create or replace function public.join_league(
  p_invite_code text,
  p_team_name text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_league public.leagues%rowtype;
  v_count int;
begin
  if v_user is null then
    raise exception 'Authentication required';
  end if;

  select *
  into v_league
  from public.leagues
  where invite_code = upper(trim(p_invite_code))
  for update;

  if not found then
    raise exception 'Invite code not found';
  end if;

  if exists (
    select 1
    from public.drafts
    where league_id = v_league.id
  ) then
    raise exception 'This league draft has already started';
  end if;

  select count(*)
  into v_count
  from public.league_members
  where league_id = v_league.id;

  if v_count >= v_league.size then
    raise exception 'League is full';
  end if;

  insert into public.league_members(
    league_id,
    user_id,
    team_name,
    draft_slot
  ) values (
    v_league.id,
    v_user,
    trim(p_team_name),
    v_count + 1
  );

  return v_league.id;
end
$$;

revoke all on function public.start_draft(uuid, smallint) from public, anon;
grant execute on function public.start_draft(uuid, smallint) to authenticated;

revoke all on function public.join_league(text, text) from public, anon;
grant execute on function public.join_league(text, text) to authenticated;
