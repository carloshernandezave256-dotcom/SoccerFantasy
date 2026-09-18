-- Retired seed profiles must not win identity matching over the canonical player registry.
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
   -- Reviewed duplicate provider profiles can share one canonical fantasy identity.
   select player_id into matched from public.sportmonks_player_profiles where sportmonks_id=sm_id for update;
  end if;
  if matched is null then
   -- Exact, unique full/display/common names within the confirmed club only.
   select array_agg(id) into candidates from public.players p
   where p.sportmonks_id is null and (p.api_football_id is not null or p.provider_id like 'sportmonks:%') and p.club=item->>'club' and p.competition=item->>'competition'
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
