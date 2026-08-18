begin;
create or replace function public.finalize_api_football_draft_pool(p_api_ids jsonb) returns integer
language plpgsql security definer set search_path=''
as $f$
declare v_count integer;
begin
 if coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','')<>'service_role' then raise exception 'Server access required'; end if;
 if jsonb_typeof(p_api_ids)<>'array' or jsonb_array_length(p_api_ids)>3000 then raise exception 'Invalid API player pool'; end if;
 update public.players set active=false,draft_rank=null where active=true or draft_rank is not null;
 with perf as (
   select (value#>>'{}')::bigint api_id,ordinality::integer performance_rank
   from jsonb_array_elements(p_api_ids) with ordinality
 ), c as (
   select p.id,o.star_priority,
   (case p.club
    when 'Real Madrid' then 1000 when 'Barcelona' then 980 when 'Manchester City' then 970 when 'Liverpool' then 960
    when 'Bayern München' then 950 when 'Paris Saint Germain' then 945 when 'Arsenal' then 940 when 'Inter' then 920
    when 'Chelsea' then 900 when 'Manchester United' then 890 when 'Juventus' then 885 when 'AC Milan' then 880
    when 'Atletico Madrid' then 875 when 'Borussia Dortmund' then 870 when 'Tottenham' then 850 when 'Napoli' then 845
    when 'Atalanta' then 830 when 'Aston Villa' then 825 when 'Newcastle' then 820 when 'RB Leipzig' then 815
    when 'Bayer Leverkusen' then 810 else 500 end
    +case p.position when 'FWD' then 80 when 'MID' then 55 when 'DEF' then 25 else 10 end
    +greatest(0,500-perf.performance_rank)) score,perf.performance_rank
   from perf join public.players p on p.api_football_id=perf.api_id
   left join public.player_stardom_overrides o on o.api_football_id=p.api_football_id
 ), ordered as (
   select id,row_number() over(order by case when star_priority is not null then 0 else 1 end,
   star_priority nulls last,score desc,performance_rank,id)::integer new_rank from c
 )
 update public.players p set active=true,draft_rank=o.new_rank from ordered o where p.id=o.id;
 select count(*) into v_count from public.players where active and api_football_id is not null;
 return v_count;
end $f$;
revoke all on function public.finalize_api_football_draft_pool(jsonb) from public,anon,authenticated;
grant execute on function public.finalize_api_football_draft_pool(jsonb) to service_role;
update public.players set active=false,draft_rank=null where api_football_id=306;
with ordered as (
 select p.id,row_number() over(order by case when o.star_priority is not null then 0 else 1 end,o.star_priority nulls last,p.draft_rank nulls last,p.id)::integer new_rank
 from public.players p left join public.player_stardom_overrides o on o.api_football_id=p.api_football_id where p.active
)
update public.players p set draft_rank=o.new_rank from ordered o where p.id=o.id;
commit;
