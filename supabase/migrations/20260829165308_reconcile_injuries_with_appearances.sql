alter table public.players
  add column if not exists availability_last_appearance_at timestamptz;

comment on column public.players.availability_last_appearance_at is
  'Latest real-match kickoff at which scoring data proves that the player appeared.';

create or replace function public.reconcile_player_availability_from_appearances(
  p_appearances jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cleared integer := 0;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'Service role required';
  end if;

  if jsonb_typeof(p_appearances) <> 'array' then
    raise exception 'Appearances must be a JSON array';
  end if;

  with supplied as (
    select appearance.player_id, appearance.kickoff
    from jsonb_to_recordset(p_appearances) as appearance(
      player_id bigint,
      kickoff timestamptz
    )
    where appearance.player_id is not null
      and appearance.kickoff is not null
      and appearance.kickoff <= now() + interval '5 minutes'
  ),
  latest as (
    select player_id, max(kickoff) as kickoff
    from supplied
    group by player_id
  ),
  decisions as (
    select latest.player_id, latest.kickoff,
      player.injured
        and (player.injury_updated_at is null or player.injury_updated_at <= latest.kickoff)
        as clear_injury
    from latest
    join public.players as player on player.id = latest.player_id
  ),
  updated as (
    update public.players as player
    set availability_last_appearance_at = greatest(
          coalesce(player.availability_last_appearance_at, '-infinity'::timestamptz),
          decisions.kickoff
        ),
        injured = case
          when decisions.clear_injury then false else player.injured end,
        expected_return = case
          when decisions.clear_injury then null else player.expected_return end,
        fotmob_expected_return = case
          when decisions.clear_injury then null else player.fotmob_expected_return end,
        sidelined_checked_at = case
          when decisions.clear_injury then null else player.sidelined_checked_at end,
        fotmob_return_checked_at = case
          when decisions.clear_injury then null else player.fotmob_return_checked_at end
    from decisions
    where player.id = decisions.player_id
    returning decisions.clear_injury as cleared
  )
  select count(*) filter (where cleared) into v_cleared from updated;

  return v_cleared;
end;
$$;

revoke all on function public.reconcile_player_availability_from_appearances(jsonb)
  from public, anon, authenticated;
grant execute on function public.reconcile_player_availability_from_appearances(jsonb)
  to service_role;
