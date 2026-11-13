-- Modern Supabase secret keys are translated to the service_role database role
-- by the API gateway, but callers should not depend on legacy JWT GUC fields.
create or replace function public.sync_api_player_common_names(p_players jsonb)
returns integer
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_item jsonb;
  v_count integer:=0;
  v_name text;
begin
  if jsonb_typeof(p_players)<>'array' or jsonb_array_length(p_players)>500 then
    raise exception 'Common-name sync accepts arrays of at most 500 players';
  end if;

  for v_item in select value from jsonb_array_elements(p_players) loop
    v_name:=nullif(trim(v_item->>'commonName'),'');
    if v_name is not null then
      update public.players
      set full_name=v_name
      where api_football_id=(v_item->>'apiFootballId')::bigint
        and full_name is distinct from v_name;
      v_count:=v_count+case when found then 1 else 0 end;
    end if;
  end loop;

  return v_count;
end
$$;

revoke all on function public.sync_api_player_common_names(jsonb)
from public,anon,authenticated;
grant execute on function public.sync_api_player_common_names(jsonb)
to service_role;
