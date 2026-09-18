-- Durable provider crosswalks preserve fantasy identities, positions and scores.
alter table public.players add column if not exists sportmonks_id bigint;
create unique index if not exists players_sportmonks_id_key on public.players(sportmonks_id);
alter table public.football_fixture_cache add column if not exists sportmonks_id bigint;
create unique index if not exists football_fixture_sportmonks_id_key on public.football_fixture_cache(sportmonks_id);
create table public.sportmonks_teams (
 sportmonks_id bigint primary key, club text not null, competition text not null,
 unique(competition,club)
);
alter table public.sportmonks_teams enable row level security;
revoke all on public.sportmonks_teams from public,anon,authenticated;
grant select,insert,update on public.sportmonks_teams to service_role;
create table public.sportmonks_player_profiles (
 sportmonks_id bigint primary key, player_id bigint references public.players(id),
 club text not null, competition text not null, raw_data jsonb not null,
 observed_at timestamptz not null default now()
);
alter table public.sportmonks_player_profiles enable row level security;
revoke all on public.sportmonks_player_profiles from public,anon,authenticated;
grant select,insert,update on public.sportmonks_player_profiles to service_role;
-- Bootstrap only from already reviewed Week 4 fixture identities.
update public.players p set sportmonks_id=m.sm_id
from (select distinct key::bigint sm_id,value::bigint player_id
 from public.sportmonks_fixture_sources,jsonb_each_text(player_map)) m
where p.id=m.player_id;
update public.football_fixture_cache f set sportmonks_id=s.sportmonks_id
from public.sportmonks_fixture_sources s where s.fixture_id=f.fixture_id;
insert into public.sportmonks_teams(sportmonks_id,club,competition)
select distinct (p->>'id')::bigint,
 case p->'meta'->>'location' when 'home' then f.home_team else f.away_team end,f.competition
from public.sportmonks_fixture_sources s join public.football_fixture_cache f using(fixture_id),
jsonb_array_elements(s.raw_data->'participants') p;

create or replace function public.sync_sportmonks_profiles(p_profiles jsonb,p_names_only boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare item jsonb; profile jsonb; matched bigint; candidates bigint[]; sm_id bigint; pos public.player_position;
 mapped integer:=0; unresolved integer:=0; ids jsonb:='{}';
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Server access required'; end if;
 if jsonb_typeof(p_profiles)<>'array' or jsonb_array_length(p_profiles)>500 then raise exception 'At most 500 profiles'; end if;
 for item in select value from jsonb_array_elements(p_profiles) loop
  profile:=item->'player'; sm_id:=(profile->>'id')::bigint; matched:=null;
  if sm_id is null or sm_id<=0 or nullif(item->>'club','') is null then raise exception 'Invalid profile'; end if;
  select id into matched from public.players where sportmonks_id=sm_id for update;
  if matched is null then
   -- Exact, unique full/display/common names within the confirmed club only.
   select array_agg(id) into candidates from public.players p
   where p.sportmonks_id is null and p.club=item->>'club' and p.competition=item->>'competition'
   and lower(regexp_replace(p.full_name,'[^[:alnum:]]','','g')) in
    (lower(regexp_replace(profile->>'name','[^[:alnum:]]','','g')),
     lower(regexp_replace(profile->>'display_name','[^[:alnum:]]','','g')),
     lower(regexp_replace(profile->>'common_name','[^[:alnum:]]','','g')));
   if cardinality(candidates)=1 then
    matched:=candidates[1];
    update public.players set sportmonks_id=sm_id where id=matched and sportmonks_id is null;
   end if;
  end if;
  insert into public.sportmonks_player_profiles(sportmonks_id,player_id,club,competition,raw_data)
  values(sm_id,matched,item->>'club',item->>'competition',profile)
  on conflict(sportmonks_id) do update set player_id=excluded.player_id,club=excluded.club,
   competition=excluded.competition,raw_data=excluded.raw_data,observed_at=now();
  if matched is not null then
   update public.players set
    full_name=coalesce(nullif(profile->>'display_name',''),nullif(profile->>'common_name',''),full_name),
    photo_url=case when p_names_only then photo_url else coalesce(nullif(profile->>'image_path',''),photo_url) end,
    club=case when p_names_only then club else item->>'club' end,
    competition=case when p_names_only then competition else item->>'competition' end
   where id=matched;
   ids:=ids||jsonb_build_object(sm_id::text,matched); mapped:=mapped+1;
  else unresolved:=unresolved+1;
  end if;
 end loop;
 return jsonb_build_object('mapped',mapped,'unresolved',unresolved,'playerMap',ids);
end $$;
revoke all on function public.sync_sportmonks_profiles(jsonb,boolean) from public,anon,authenticated;
grant execute on function public.sync_sportmonks_profiles(jsonb,boolean) to service_role;
-- Keep per-fixture scoring thresholds when publishing a weekly sum from either provider.
do $$ declare d text; begin
 select pg_get_functiondef('private.calculate_league_player_row()'::regprocedure) into d;
 d:=replace(d,'new.source=''api-football-fixture-sum''', 'new.source in (''api-football-fixture-sum'',''sportmonks-fixture-sum'')');
 execute d;
 select pg_get_functiondef('private.preserve_verified_dnp_evidence()'::regprocedure) into d;
 d:=replace(d,'new.source = ''api-football-fixture-sum''','new.source in (''api-football-fixture-sum'',''sportmonks-fixture-sum'')');
 execute d;
end $$;
