create table if not exists public.player_club_appearances (
  fixture_id bigint not null,
  player_id bigint not null references public.players(id) on delete cascade,
  club text not null,
  competition text not null,
  kickoff timestamptz not null,
  observed_at timestamptz not null default now(),
  primary key (fixture_id, player_id)
);

create index if not exists player_club_appearances_latest_idx
  on public.player_club_appearances(player_id, kickoff desc, observed_at desc);

alter table public.player_club_appearances enable row level security;
revoke all on table public.player_club_appearances from public, anon, authenticated;
grant select, insert, update, delete on table public.player_club_appearances to service_role;

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
  ), saved as (
    insert into public.player_club_appearances(
      fixture_id, player_id, club, competition, kickoff, observed_at
    )
    select fixture_id, player_id, club, competition, kickoff, observed_at
    from valid
    on conflict (fixture_id, player_id) do update set
      club = excluded.club,
      competition = excluded.competition,
      kickoff = excluded.kickoff,
      observed_at = excluded.observed_at
    returning player_id
  ), latest as (
    select distinct on (appearance.player_id)
      appearance.player_id, appearance.club, appearance.competition
    from public.player_club_appearances appearance
    join (select distinct player_id from saved) touched using (player_id)
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

create or replace function public.sync_api_football_players(p_players jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_item jsonb;
  v_count integer := 0;
  v_position public.player_position;
  v_id bigint;
  v_provider_id text;
  v_confirmed_club text;
  v_confirmed_competition text;
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role', '') <> 'service_role' then
    raise exception 'Server access required';
  end if;
  if jsonb_typeof(p_players) <> 'array' or jsonb_array_length(p_players) > 500 then
    raise exception 'Player sync accepts arrays of at most 500 players';
  end if;

  for v_item in select value from jsonb_array_elements(p_players) loop
    v_provider_id := 'api-football:' || (v_item->>'apiFootballId');
    v_position := case v_item->>'position'
      when 'Goalkeeper' then 'GK'::public.player_position
      when 'Defender' then 'DEF'::public.player_position
      when 'Midfielder' then 'MID'::public.player_position
      else 'FWD'::public.player_position
    end;
    v_id := null;
    v_confirmed_club := null;
    v_confirmed_competition := null;

    select id into v_id
    from public.players
    where api_football_id = (v_item->>'apiFootballId')::bigint or provider_id = v_provider_id
    order by case when api_football_id = (v_item->>'apiFootballId')::bigint then 0 else 1 end
    limit 1 for update;

    if v_id is null then
      insert into public.players(
        provider_id, api_football_id, full_name, position, club, competition,
        photo_url, nationality, active, draft_rank
      ) values (
        v_provider_id, (v_item->>'apiFootballId')::bigint, v_item->>'fullName',
        v_position, v_item->>'club', v_item->>'competition', v_item->>'photoUrl',
        v_item->>'nationality', false, null
      );
    else
      select appearance.club, appearance.competition
      into v_confirmed_club, v_confirmed_competition
      from public.player_club_appearances appearance
      where appearance.player_id = v_id
      order by appearance.kickoff desc, appearance.observed_at desc, appearance.fixture_id desc
      limit 1;

      update public.players set
        provider_id = v_provider_id,
        api_football_id = (v_item->>'apiFootballId')::bigint,
        full_name = v_item->>'fullName',
        club = coalesce(v_confirmed_club, v_item->>'club'),
        competition = coalesce(v_confirmed_competition, v_item->>'competition'),
        photo_url = v_item->>'photoUrl',
        nationality = v_item->>'nationality'
      where id = v_id;
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end
$function$;

revoke all on function public.sync_api_football_players(jsonb)
  from public, anon, authenticated;
grant execute on function public.sync_api_football_players(jsonb) to service_role;
