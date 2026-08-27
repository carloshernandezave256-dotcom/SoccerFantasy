-- Current Top Five squad feeds can exceed 3,000 unique player IDs.
-- Keep the endpoint bounded while allowing the production pool to finalize.
create or replace function public.finalize_api_football_draft_pool(p_api_ids jsonb)
returns integer language plpgsql security definer set search_path='' as $$
declare v_count integer;v_current_count integer;
begin
if coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','')<>'service_role' then raise exception 'Server access required'; end if;
if jsonb_typeof(p_api_ids)<>'array' or jsonb_array_length(p_api_ids)>5000 then raise exception 'Invalid API player pool: expected an array of at most 5000 player IDs'; end if;
v_current_count:=jsonb_array_length(p_api_ids);
with ranked as(
  select (value#>>'{}')::bigint api_id,ordinality::integer rank
  from jsonb_array_elements(p_api_ids) with ordinality
)
update public.players p
set active=true,draft_rank=r.rank
from ranked r
where p.api_football_id=r.api_id;

with missing as(
  select p.id,row_number() over(order by coalesce(p.draft_rank,2147483647),p.id)::integer rn
  from public.players p
  where p.active
    and p.api_football_id is not null
    and not exists(
      select 1 from jsonb_array_elements_text(p_api_ids) x(api_id)
      where x.api_id::bigint=p.api_football_id
    )
)
update public.players p
set draft_rank=v_current_count+m.rn
from missing m
where p.id=m.id;

select count(*) into v_count from public.players where active and api_football_id is not null;
return v_count;end $$;

revoke all on function public.finalize_api_football_draft_pool(jsonb) from public,anon,authenticated;
grant execute on function public.finalize_api_football_draft_pool(jsonb) to service_role;

comment on function public.finalize_api_football_draft_pool(jsonb) is
'Ranks players returned by the latest API-Football squad sync while preserving previously active players temporarily omitted by one provider response. Accepts at most 5000 IDs.';
