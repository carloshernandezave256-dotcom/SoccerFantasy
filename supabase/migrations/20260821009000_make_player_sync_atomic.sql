create or replace function public.sync_api_football_players(p_players jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_count integer := 0;
  v_position public.player_position;
  v_id bigint;
  v_provider_id text;
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
      update public.players set
        provider_id = v_provider_id,
        api_football_id = (v_item->>'apiFootballId')::bigint,
        full_name = v_item->>'fullName',
        position = v_position,
        club = v_item->>'club',
        competition = v_item->>'competition',
        photo_url = v_item->>'photoUrl',
        nationality = v_item->>'nationality'
      where id = v_id;
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end
$$;

revoke all on function public.sync_api_football_players(jsonb) from public, anon, authenticated;
grant execute on function public.sync_api_football_players(jsonb) to service_role;

create or replace function public.finalize_api_football_draft_pool(p_api_ids jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role', '') <> 'service_role' then
    raise exception 'Server access required';
  end if;
  if jsonb_typeof(p_api_ids) <> 'array' or jsonb_array_length(p_api_ids) > 5000 then
    raise exception 'Invalid API player pool';
  end if;

  update public.players set active = false, draft_rank = null
  where active = true or draft_rank is not null;

  with perf as (
    select (value#>>'{}')::bigint api_id, ordinality::integer performance_rank
    from jsonb_array_elements(p_api_ids) with ordinality
  ), candidates as (
    select p.id, o.star_priority,
      (case p.club
        when 'Real Madrid' then 1000 when 'Barcelona' then 980 when 'Manchester City' then 970 when 'Liverpool' then 960
        when 'Bayern München' then 950 when 'Paris Saint Germain' then 945 when 'Arsenal' then 940 when 'Inter' then 920
        when 'Chelsea' then 900 when 'Manchester United' then 890 when 'Juventus' then 885 when 'AC Milan' then 880
        when 'Atletico Madrid' then 875 when 'Borussia Dortmund' then 870 when 'Tottenham' then 850 when 'Napoli' then 845
        when 'Atalanta' then 830 when 'Aston Villa' then 825 when 'Newcastle' then 820 when 'RB Leipzig' then 815
        when 'Bayer Leverkusen' then 810 else 500 end
        + case p.position when 'FWD' then 80 when 'MID' then 55 when 'DEF' then 25 else 10 end
        + greatest(0, 500 - perf.performance_rank)) score,
      perf.performance_rank
    from perf
    join public.players p on p.api_football_id = perf.api_id
    left join public.player_stardom_overrides o on o.api_football_id = p.api_football_id
  ), ordered as (
    select id, row_number() over (
      order by case when star_priority is not null then 0 else 1 end,
        star_priority nulls last, score desc, performance_rank, id
    )::integer new_rank
    from candidates
  )
  update public.players p set active = true, draft_rank = ordered.new_rank
  from ordered where p.id = ordered.id;

  select count(*) into v_count
  from public.players where active and api_football_id is not null;
  return v_count;
end
$$;

revoke all on function public.finalize_api_football_draft_pool(jsonb) from public, anon, authenticated;
grant execute on function public.finalize_api_football_draft_pool(jsonb) to service_role;
