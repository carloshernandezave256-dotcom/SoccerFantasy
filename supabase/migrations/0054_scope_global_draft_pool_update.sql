create or replace function public.finalize_api_football_draft_pool(p_api_ids jsonb)
returns integer language plpgsql security definer set search_path='' as $$
declare v_count integer;
begin
if coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','')<>'service_role' then raise exception 'Server access required';end if;
if jsonb_typeof(p_api_ids)<>'array' or jsonb_array_length(p_api_ids)>3000 then raise exception 'Invalid API player pool';end if;
update public.players set active=false,draft_rank=null where active=true or draft_rank is not null;
with ranked as(select (value#>>'{}')::bigint api_id,ordinality::integer rank from jsonb_array_elements(p_api_ids) with ordinality)
update public.players p set active=true,draft_rank=r.rank from ranked r where p.api_football_id=r.api_id;
select count(*) into v_count from public.players where active and api_football_id is not null;return v_count;end $$;
revoke all on function public.finalize_api_football_draft_pool(jsonb) from public,anon,authenticated;grant execute on function public.finalize_api_football_draft_pool(jsonb) to service_role;\n