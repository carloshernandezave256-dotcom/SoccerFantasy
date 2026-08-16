create or replace function public.reconcile_api_football_players()
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare
  v_count integer:=0;
begin
  if coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','')<>'service_role' then
    raise exception 'Server access required';
  end if;

  with candidates as (
    select legacy.id as legacy_id,api.full_name,api.position,api.club,api.competition,
      api.photo_url,api.nationality,count(*) over(partition by legacy.id) as match_count
    from public.players legacy
    join public.players api on api.api_football_id is not null
      and api.position=legacy.position
      and lower(extensions.unaccent(api.full_name)) like
        '%'||replace(lower(extensions.unaccent(legacy.full_name)),' ','%')||'%'
    where legacy.api_football_id is null
  ), unique_matches as (select * from candidates where match_count=1)
  update public.players legacy set full_name=m.full_name,position=m.position,club=m.club,
    competition=m.competition,photo_url=m.photo_url,nationality=m.nationality,active=true
  from unique_matches m where legacy.id=m.legacy_id;
  get diagnostics v_count=row_count;
  return v_count;
end
$$;

revoke all on function public.reconcile_api_football_players() from public,anon,authenticated;
grant execute on function public.reconcile_api_football_players() to service_role;

with candidates as (
  select legacy.id as legacy_id,api.full_name,api.position,api.club,api.competition,
    api.photo_url,api.nationality,count(*) over(partition by legacy.id) as match_count
  from public.players legacy
  join public.players api on api.api_football_id is not null
    and api.position=legacy.position
    and lower(extensions.unaccent(api.full_name)) like
      '%'||replace(lower(extensions.unaccent(legacy.full_name)),' ','%')||'%'
  where legacy.api_football_id is null
), unique_matches as (select * from candidates where match_count=1)
update public.players legacy set full_name=m.full_name,position=m.position,club=m.club,
  competition=m.competition,photo_url=m.photo_url,nationality=m.nationality,active=true
from unique_matches m where legacy.id=m.legacy_id;
