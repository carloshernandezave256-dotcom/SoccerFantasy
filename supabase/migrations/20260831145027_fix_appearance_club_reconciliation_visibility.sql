create or replace function public.reconcile_player_clubs_from_appearances(p_appearances jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_changed integer := 0;
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
      appearance.player_id, appearance.club, appearance.competition
    from public.player_club_appearances appearance
    join touched using (player_id)
    order by appearance.player_id, appearance.kickoff desc,
             appearance.observed_at desc, appearance.fixture_id desc
  ), changed as (
    update public.players player
    set club = latest.club,
        competition = latest.competition
    from latest
    where player.id = latest.player_id
      and (player.club is distinct from latest.club
        or player.competition is distinct from latest.competition)
    returning player.id
  )
  select count(*)::integer into v_changed from changed;

  return v_changed;
end
$function$;

revoke all on function public.reconcile_player_clubs_from_appearances(jsonb)
  from public, anon, authenticated;
grant execute on function public.reconcile_player_clubs_from_appearances(jsonb)
  to service_role;
