create or replace function public.finalize_api_football_draft_pool(p_api_ids jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_count integer;
  v_ranked_ids bigint[];
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
  )
  select array_agg(
    p.id order by
      case when o.star_priority is not null then 0 else 1 end,
      o.star_priority nulls last,
      case when p.active then 0 else 1 end,
      p.draft_rank nulls last,
      i.api_order,
      p.id
  )
  into v_ranked_ids
  from incoming i
  join public.players p on p.api_football_id = i.api_id
  left join public.player_stardom_overrides o on o.api_football_id = p.api_football_id;

  update public.players
  set active = false, draft_rank = null
  where active or draft_rank is not null;

  with ranked as (
    select id, ordinality::integer as new_rank
    from unnest(coalesce(v_ranked_ids, array[]::bigint[])) with ordinality as r(id, ordinality)
  )
  update public.players p
  set active = true, draft_rank = r.new_rank
  from ranked r
  where p.id = r.id;

  select count(*) into v_count
  from public.players
  where active and api_football_id is not null;

  return v_count;
end
$function$;

revoke all on function public.finalize_api_football_draft_pool(jsonb) from public, anon, authenticated;
grant execute on function public.finalize_api_football_draft_pool(jsonb) to service_role;
