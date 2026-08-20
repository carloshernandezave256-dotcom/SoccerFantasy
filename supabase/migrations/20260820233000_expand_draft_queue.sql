create or replace function public.set_draft_queue(
  p_league_id uuid,
  p_player_ids bigint[]
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_count integer := coalesce(cardinality(p_player_ids), 0);
  v_valid integer;
begin
  if v_user is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1
    from public.league_members
    where league_id = p_league_id and user_id = v_user
  ) then
    raise exception 'League membership required';
  end if;

  if exists (
    select 1
    from public.drafts
    where league_id = p_league_id and status in ('paused', 'complete')
  ) then
    raise exception 'Draft queue is closed';
  end if;

  if v_count > 100 then
    raise exception 'Your draft queue can contain at most 100 players';
  end if;

  if v_count <> (
    select count(distinct item)
    from unnest(coalesce(p_player_ids, '{}'::bigint[])) item
  ) then
    raise exception 'A player can only appear once in your queue';
  end if;

  select count(*) into v_valid
  from public.players player
  where player.id = any(coalesce(p_player_ids, '{}'::bigint[]))
    and private.player_in_league_pool(p_league_id, player.id)
    and not exists (
      select 1
      from public.draft_picks pick
      where pick.league_id = p_league_id and pick.player_id = player.id
    );

  if v_valid <> v_count then
    raise exception 'Every queued player must be active, available and inside this league pool';
  end if;

  delete from public.draft_queue
  where league_id = p_league_id and user_id = v_user;

  insert into public.draft_queue (league_id, user_id, player_id, priority)
  select p_league_id, v_user, item, ordinality::smallint
  from unnest(coalesce(p_player_ids, '{}'::bigint[]))
    with ordinality queued(item, ordinality);
end
$$;

revoke all on function public.set_draft_queue(uuid, bigint[]) from public, anon;
grant execute on function public.set_draft_queue(uuid, bigint[]) to authenticated;
