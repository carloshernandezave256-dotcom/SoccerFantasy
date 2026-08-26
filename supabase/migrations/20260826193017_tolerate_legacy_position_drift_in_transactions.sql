-- Provider position updates briefly reclassified existing fantasy players after
-- the draft. Preserve strict rules for legal rosters, while allowing an
-- already-drifted roster to make a transaction that does not worsen any
-- position-count deviation. This lets like-for-like waiver claims proceed and
-- still blocks moves that increase the imbalance or exceed four per club.
create or replace function private.roster_is_legal(
  p_league_id uuid,
  p_user_id uuid,
  p_remove bigint[] default '{}'::bigint[],
  p_add bigint[] default '{}'::bigint[]
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with current_roster as (
    select dp.player_id
    from public.draft_picks dp
    where dp.league_id = p_league_id
      and dp.user_id = p_user_id
  ), projected_roster as (
    select player_id
    from current_roster
    where not (player_id = any(coalesce(p_remove, '{}'::bigint[])))
    union all
    select unnest(coalesce(p_add, '{}'::bigint[]))
  ), current_counts as (
    select
      count(*) total,
      count(*) filter (where p.position = 'GK') gk,
      count(*) filter (where p.position = 'DEF') def,
      count(*) filter (where p.position = 'MID') mid,
      count(*) filter (where p.position = 'FWD') fwd
    from current_roster r
    join public.players p on p.id = r.player_id
  ), projected_counts as (
    select
      count(*) total,
      count(*) filter (where p.position = 'GK') gk,
      count(*) filter (where p.position = 'DEF') def,
      count(*) filter (where p.position = 'MID') mid,
      count(*) filter (where p.position = 'FWD') fwd,
      coalesce(max(club_count), 0) max_club
    from projected_roster r
    join public.players p on p.id = r.player_id
    left join lateral (
      select count(*) club_count
      from projected_roster r2
      join public.players p2 on p2.id = r2.player_id
      where p2.club = p.club
    ) clubs on true
  )
  select
    projected.total = 18
    and projected.max_club <= 4
    and (
      (
        current.total = 18
        and current.gk = 2
        and current.def = 6
        and current.mid = 5
        and current.fwd = 5
        and projected.gk = 2
        and projected.def = 6
        and projected.mid = 5
        and projected.fwd = 5
      )
      or (
        not (
          current.total = 18
          and current.gk = 2
          and current.def = 6
          and current.mid = 5
          and current.fwd = 5
        )
        and abs(projected.gk - 2) <= abs(current.gk - 2)
        and abs(projected.def - 6) <= abs(current.def - 6)
        and abs(projected.mid - 5) <= abs(current.mid - 5)
        and abs(projected.fwd - 5) <= abs(current.fwd - 5)
      )
    )
  from current_counts current
  cross join projected_counts projected
$$;

revoke all on function private.roster_is_legal(uuid, uuid, bigint[], bigint[])
from public, anon, authenticated;
