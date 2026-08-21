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
    where api_football_id = (v_item->>'apiFootballId')::bigint
       or provider_id = v_provider_id
    order by case when api_football_id = (v_item->>'apiFootballId')::bigint then 0 else 1 end
    limit 1
    for update;

    if v_id is null then
      insert into public.players(
        provider_id, api_football_id, full_name, position, club, competition,
        photo_url, nationality, active, draft_rank
      ) values (
        v_provider_id, (v_item->>'apiFootballId')::bigint, v_item->>'fullName',
        v_position, v_item->>'club', v_item->>'competition', v_item->>'photoUrl',
        v_item->>'nationality', false, null
      ) returning id into v_id;
    else
      update public.players set
        provider_id = v_provider_id,
        api_football_id = (v_item->>'apiFootballId')::bigint,
        full_name = v_item->>'fullName',
        position = v_position,
        club = v_item->>'club',
        competition = v_item->>'competition',
        photo_url = v_item->>'photoUrl',
        nationality = v_item->>'nationality',
        active = false,
        draft_rank = null
      where id = v_id;
    end if;

    v_count := v_count + 1;
  end loop;

  return v_count;
end
$$;

revoke all on function public.sync_api_football_players(jsonb) from public, anon, authenticated;
grant execute on function public.sync_api_football_players(jsonb) to service_role;
