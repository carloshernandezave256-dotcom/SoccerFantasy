
create table if not exists public.player_stardom_overrides (
 api_football_id bigint primary key, star_priority integer not null unique check(star_priority between 1 and 150),
 label text not null, updated_at timestamptz not null default now()
);
alter table public.player_stardom_overrides enable row level security;
revoke all on table public.player_stardom_overrides from anon,authenticated;
grant all on table public.player_stardom_overrides to service_role;
insert into public.player_stardom_overrides(api_football_id,star_priority,label) values
(1100,1,'Erling Haaland'),(278,2,'Kylian Mbappe'),(386828,3,'Lamine Yamal'),(762,4,'Vinicius Junior'),
(153,5,'Ousmane Dembele'),(203224,6,'Florian Wirtz'),(181812,7,'Jamal Musiala'),(756,8,'Federico Valverde'),
(217,9,'Lautaro Martinez'),(1622,10,'Gianluigi Donnarumma'),(730,11,'Thibaut Courtois'),(280,12,'Alisson'),
(37127,13,'Martin Odegaard'),(2937,14,'Declan Rice'),(483,15,'Khvicha Kvaratskhelia'),(9,16,'Achraf Hakimi'),
(290,17,'Virgil van Dijk'),(22090,18,'William Saliba'),(31009,19,'Alessandro Bastoni'),(30558,20,'Nicolo Barella'),
(1485,21,'Bruno Fernandes'),(631,22,'Phil Foden'),(6009,23,'Julian Alvarez'),(19617,24,'Michael Olise'),
(502,25,'Joshua Kimmich'),(22221,26,'Mike Maignan'),(19465,27,'David Raya'),(6716,28,'Alexis Mac Allister'),
(1096,29,'Dominik Szoboszlai'),(247,30,'Cody Gakpo'),(2285,31,'Antonio Rudiger'),(2207,32,'Eduardo Camavinga'),
(1271,33,'Aurelien Tchouameni'),(291964,34,'Arda Guler'),(396623,35,'Pau Cubarsi'),(538,36,'Frenkie de Jong'),
(339883,37,'Kenan Yildiz'),(21393,38,'Serhou Guirassy'),(26243,39,'Nico Schlotterbeck'),(972,40,'Jonathan Tah'),
(36902,41,'Tijjani Reijnders')
on conflict(api_football_id) do update set star_priority=excluded.star_priority,label=excluded.label,updated_at=now();

create or replace function public.finalize_api_football_draft_pool(p_api_ids jsonb) returns integer
language plpgsql security definer set search_path=''
as $f$
declare v_count integer;
begin
 if coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','')<>'service_role' then raise exception 'Server access required'; end if;
 if jsonb_typeof(p_api_ids)<>'array' or jsonb_array_length(p_api_ids)>3000 then raise exception 'Invalid API player pool'; end if;
 update public.players set active=false,draft_rank=null where active=true or draft_rank is not null;
 with perf as (
   select (value#>>'{}')::bigint api_id,ordinality::integer performance_rank from jsonb_array_elements(p_api_ids) with ordinality
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
 select count(*) into v_count from public.players where active and api_football_id is not null; return v_count;
end $f$;
revoke all on function public.finalize_api_football_draft_pool(jsonb) from public,anon,authenticated;
grant execute on function public.finalize_api_football_draft_pool(jsonb) to service_role;

update public.players set draft_rank=-draft_rank where active and api_football_id is not null and draft_rank>0;

with c as (
 select p.id,o.star_priority,
 (case p.club
  when 'Real Madrid' then 1000 when 'Barcelona' then 980 when 'Manchester City' then 970 when 'Liverpool' then 960
  when 'Bayern München' then 950 when 'Paris Saint Germain' then 945 when 'Arsenal' then 940 when 'Inter' then 920
  when 'Chelsea' then 900 when 'Manchester United' then 890 when 'Juventus' then 885 when 'AC Milan' then 880
  when 'Atletico Madrid' then 875 when 'Borussia Dortmund' then 870 when 'Tottenham' then 850 when 'Napoli' then 845
  when 'Atalanta' then 830 when 'Aston Villa' then 825 when 'Newcastle' then 820 when 'RB Leipzig' then 815
  when 'Bayer Leverkusen' then 810 else 500 end
  +case p.position when 'FWD' then 80 when 'MID' then 55 when 'DEF' then 25 else 10 end
  +greatest(0,500-abs(p.draft_rank))) score,abs(p.draft_rank) performance_rank
 from public.players p left join public.player_stardom_overrides o on o.api_football_id=p.api_football_id
 where p.active and p.api_football_id is not null
), ordered as (
 select id,row_number() over(order by case when star_priority is not null then 0 else 1 end,
 star_priority nulls last,score desc,performance_rank,id)::integer new_rank from c
)
update public.players p set draft_rank=o.new_rank from ordered o where p.id=o.id;
