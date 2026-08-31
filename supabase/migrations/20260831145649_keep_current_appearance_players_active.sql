create or replace function public.reconcile_player_clubs_from_appearances(p_appearances jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_changed integer := 0;
  v_season_start date := case
    when extract(month from current_date) >= 7
      then make_date(extract(year from current_date)::integer, 7, 1)
    else make_date(extract(year from current_date)::integer - 1, 7, 1)
  end;
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role', '') <> 'service_role' then
    raise exception 'Server access required';
  end if;
  if jsonb_typeof(p_appearances) <> 'array' or jsonb_array_length(p_appearances) > 2000 then
    raise exception 'Club reconciliation accepts arrays of at most 2000 appearances';
  end if;

  with parsed as (
    select
      (item->>'fixture_id')::bigint as fixture_id,
      (item->>'player_id')::bigint as player_id,
      nullif(btrim(item->>'club'), '') as club,
      nullif(btrim(item->>'competition'), '') as competition,
      (item->>'kickoff')::timestamptz as kickoff,
      coalesce((item->>'observed_at')::timestamptz, now()) as observed_at
    from jsonb_array_elements(p_appearances) as source(item)
  ), valid as (
    select parsed.*
    from parsed
    join public.players player on player.id = parsed.player_id
    where parsed.fixture_id > 0
      and parsed.club is not null
      and parsed.competition in ('Premier League', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1')
      and parsed.kickoff is not null
  )
  insert into public.player_club_appearances(
    fixture_id, player_id, club, competition, kickoff, observed_at
  )
  select fixture_id, player_id, club, competition, kickoff, observed_at
  from valid
  on conflict (fixture_id, player_id) do update set
    club = excluded.club,
    competition = excluded.competition,
    kickoff = excluded.kickoff,
    observed_at = excluded.observed_at;

  with touched as (
    select distinct (item->>'player_id')::bigint as player_id
    from jsonb_array_elements(p_appearances) as source(item)
  ), latest as (
    select distinct on (appearance.player_id)
      appearance.player_id, appearance.club, appearance.competition, appearance.kickoff
    from public.player_club_appearances appearance
    join touched using (player_id)
    order by appearance.player_id, appearance.kickoff desc,
             appearance.observed_at desc, appearance.fixture_id desc
  ), changed as (
    update public.players player
    set club = latest.club,
        competition = latest.competition,
        active = case when latest.kickoff >= v_season_start then true else player.active end
    from latest
    where player.id = latest.player_id
      and (player.club is distinct from latest.club
        or player.competition is distinct from latest.competition
        or (latest.kickoff >= v_season_start and not player.active))
    returning player.id
  )
  select count(*)::integer into v_changed from changed;

  with touched as (
    select distinct (item->>'player_id')::bigint as player_id
    from jsonb_array_elements(p_appearances) as source(item)
  ), latest as (
    select distinct on (appearance.player_id)
      appearance.player_id, appearance.kickoff
    from public.player_club_appearances appearance
    join touched using (player_id)
    order by appearance.player_id, appearance.kickoff desc,
             appearance.observed_at desc, appearance.fixture_id desc
  ), base as (
    select coalesce(max(draft_rank), 0)::integer as max_rank from public.players
  ), unranked as (
    select player.id,
           row_number() over (order by latest.kickoff desc, player.id)::integer as rank_offset
    from public.players player
    join latest on latest.player_id = player.id
    where latest.kickoff >= v_season_start
      and player.active
      and player.draft_rank is null
  )
  update public.players player
  set draft_rank = base.max_rank + unranked.rank_offset
  from unranked cross join base
  where player.id = unranked.id;

  return v_changed;
end
$function$;

revoke all on function public.reconcile_player_clubs_from_appearances(jsonb)
  from public, anon, authenticated;
grant execute on function public.reconcile_player_clubs_from_appearances(jsonb)
  to service_role;

create or replace function public.finalize_api_football_draft_pool(p_api_ids jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_count integer;
  v_ranked_ids bigint[];
  v_season_start date := case
    when extract(month from current_date) >= 7
      then make_date(extract(year from current_date)::integer, 7, 1)
    else make_date(extract(year from current_date)::integer - 1, 7, 1)
  end;
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role', '') <> 'service_role' then
    raise exception 'Server access required';
  end if;
  if jsonb_typeof(p_api_ids) <> 'array' or jsonb_array_length(p_api_ids) > 5000 then
    raise exception 'Invalid API player pool: expected an array of at most 5000 player IDs';
  end if;

  with incoming as (
    select (value #>> '{}')::bigint as api_id, min(ordinality)::integer as api_order
    from jsonb_array_elements(p_api_ids) with ordinality
    group by (value #>> '{}')::bigint
  ), confirmed as (
    select distinct player.api_football_id as api_id
    from public.player_club_appearances appearance
    join public.players player on player.id = appearance.player_id
    where appearance.kickoff >= v_season_start
      and player.api_football_id is not null
  ), eligible as (
    select api_id, min(api_order) as api_order
    from (
      select api_id, api_order from incoming
      union all
      select api_id, null::integer from confirmed
    ) source
    group by api_id
  )
  select array_agg(
    player.id order by
      case when override.star_priority is not null then 0 else 1 end,
      override.star_priority nulls last,
      case when player.active then 0 else 1 end,
      player.draft_rank nulls last,
      eligible.api_order nulls last,
      player.id
  )
  into v_ranked_ids
  from eligible
  join public.players player on player.api_football_id = eligible.api_id
  left join public.player_stardom_overrides override
    on override.api_football_id = player.api_football_id;

  update public.players
  set active = false, draft_rank = null
  where active or draft_rank is not null;

  with ranked as (
    select id, ordinality::integer as new_rank
    from unnest(coalesce(v_ranked_ids, array[]::bigint[])) with ordinality as ranked_rows(id, ordinality)
  )
  update public.players player
  set active = true, draft_rank = ranked.new_rank
  from ranked
  where player.id = ranked.id;

  select count(*) into v_count
  from public.players
  where active and api_football_id is not null;

  return v_count;
end
$function$;

revoke all on function public.finalize_api_football_draft_pool(jsonb)
  from public, anon, authenticated;
grant execute on function public.finalize_api_football_draft_pool(jsonb) to service_role;
