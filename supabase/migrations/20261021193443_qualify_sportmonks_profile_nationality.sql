-- Follow-up to the applied identity hardening migration. public.players has a
-- nationality column, so the unqualified PL/pgSQL local of the same name is
-- ambiguous in candidate queries. Rename only that local; preserve all matching,
-- conflict, transfer, locking, reviewed-alias, and access-control safeguards.
-- All declared locals were checked against the production players/profile
-- column catalogs; nationality was the only collision.
create or replace function public.sync_sportmonks_profiles(p_profiles jsonb,p_names_only boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 item jsonb; profile jsonb; staged jsonb := '[]'; proposal jsonb;
 sm_id bigint; matched bigint; direct_id bigint; reviewed_id bigint;
 candidates bigint[]; named_candidates bigint[]; names text[];
 reason text; method text; display_name text; club_name text; competition_name text;
 dob text; v_nationality text; prior_profile jsonb; item_index integer := 0;
 mapped integer := 0; unresolved integer := 0; ids jsonb := '{}'; issues jsonb := '[]';
begin
 if coalesce(auth.jwt()->>'role','') <> 'service_role' then raise exception 'Server access required'; end if;
 if jsonb_typeof(p_profiles) is distinct from 'array' then raise exception 'Profiles must be an array'; end if;
 if jsonb_array_length(p_profiles) > 500 then raise exception 'At most 500 profiles'; end if;
 if p_names_only is null then raise exception 'Names-only flag must not be null'; end if;

 -- A bounded batch must see one stable registry, including previously absent IDs.
 -- Row locks alone do not protect candidate absence or two new provider IDs racing
 -- for one canonical player. These self-exclusive locks also cover other writers;
 -- normal SELECTs remain available. Always acquire them in this order.
 lock table public.players, public.sportmonks_player_profiles in share row exclusive mode;

 -- First resolve every item against the pre-batch registry. Do not let the first
 -- of two colliding observations claim an identity merely because it came first.
 for item in select value from jsonb_array_elements(p_profiles) loop
  item_index := item_index + 1;
  profile := item->'player'; sm_id := null; matched := null; direct_id := null; reviewed_id := null;
  candidates := '{}'; named_candidates := '{}'; names := '{}'; reason := null; method := null;
  prior_profile := null; dob := null; v_nationality := null;
  display_name := case when jsonb_typeof(profile->'name')='string' then nullif(btrim(profile->>'name'),'') end;
  club_name := case when jsonb_typeof(item->'club')='string' then nullif(btrim(item->>'club'),'') end;
  competition_name := case when jsonb_typeof(item->'competition')='string' then nullif(btrim(item->>'competition'),'') end;

  if jsonb_typeof(item) is distinct from 'object' or jsonb_typeof(profile) is distinct from 'object' then
   reason := 'invalid_profile';
  else
   begin
    if coalesce(profile->>'id','') !~ '^[1-9][0-9]*$' then reason := 'invalid_sportmonks_id';
    else sm_id := (profile->>'id')::bigint; end if;
   exception when numeric_value_out_of_range or invalid_text_representation then
    reason := 'invalid_sportmonks_id';
   end;
   if reason is null and (club_name is null or competition_name is null) then reason := 'missing_club_or_competition'; end if;
  end if;

  if reason is null then
   -- Equal repeated observations are harmless. Contradictory repeats must not
   -- update anything, including an already-reviewed mapping's current club.
   if exists(select 1 from jsonb_array_elements(p_profiles) other
    where other->'player'->>'id'=sm_id::text
     and jsonb_set(other,'{player,id}',to_jsonb(sm_id)) <> jsonb_set(item,'{player,id}',to_jsonb(sm_id))) then
    reason := 'conflicting_duplicate_profile';
   end if;
  end if;

  if reason is null then
   select coalesce(array_agg(distinct normalized),'{}') into names
   from (select lower(regexp_replace(value#>>'{}','[^[:alnum:]]','','g')) normalized
    from jsonb_array_elements(jsonb_build_array(profile->'name',profile->'display_name',profile->'common_name'))
    where jsonb_typeof(value)='string') n where normalized <> '';
   display_name := coalesce(display_name,
    case when jsonb_typeof(profile->'display_name')='string' then nullif(btrim(profile->>'display_name'),'') end,
    case when jsonb_typeof(profile->'common_name')='string' then nullif(btrim(profile->>'common_name'),'') end);

   if profile->'date_of_birth' is not null and profile->'date_of_birth' <> 'null'::jsonb then
    begin
     if jsonb_typeof(profile->'date_of_birth') <> 'string' or profile->>'date_of_birth' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      reason := 'invalid_profile_attributes';
     else dob := ((profile->>'date_of_birth')::date)::text; end if;
    exception when datetime_field_overflow or invalid_datetime_format then reason := 'invalid_profile_attributes';
    end;
   end if;
   if profile->'nationality_id' is not null and profile->'nationality_id' <> 'null'::jsonb then
    begin
     if profile->>'nationality_id' !~ '^[1-9][0-9]*$' then reason := 'invalid_profile_attributes';
     else v_nationality := ((profile->>'nationality_id')::bigint)::text; end if;
    exception when numeric_value_out_of_range or invalid_text_representation then reason := 'invalid_profile_attributes';
    end;
   end if;
  end if;

  if reason is null then
   select p.id into direct_id from public.players p where p.sportmonks_id=sm_id;
   select sp.player_id,sp.raw_data into reviewed_id,prior_profile
    from public.sportmonks_player_profiles sp where sp.sportmonks_id=sm_id;
   if direct_id is not null and reviewed_id is not null and direct_id <> reviewed_id then
    reason := 'identity_mapping_conflict';
    select array_agg(x order by x) into candidates from unnest(array[direct_id,reviewed_id]) x;
   elsif coalesce(direct_id,reviewed_id) is not null then
    matched := coalesce(direct_id,reviewed_id); candidates := array[matched];
    -- Established IDs retain same-ID DOB/nationality conflict checks. DOB also
    -- agrees across reviewed aliases; nationality alone may legitimately differ
    -- between aliases (for example, dual nationality) and cannot revoke a mapping.
    if (dob is not null and nullif(prior_profile->>'date_of_birth','') is not null and prior_profile->>'date_of_birth' <> dob)
     or (v_nationality is not null and nullif(prior_profile->>'nationality_id','') is not null and prior_profile->>'nationality_id' <> v_nationality)
     or exists(select 1 from public.sportmonks_player_profiles evidence where evidence.player_id=matched
      and dob is not null and nullif(evidence.raw_data->>'date_of_birth','') is not null
      and evidence.raw_data->>'date_of_birth' <> dob) then
     reason := 'conflicting_profile_attributes'; matched := null;
    else method := case when direct_id is not null then 'direct_id' else 'reviewed_mapping' end;
    end if;
   elsif cardinality(names)=0 then
    reason := 'missing_name';
   else
    with candidate_evidence as (
     select p.id,
      -- Preserve the established exact-name + same-club rule, never claim a
      -- canonical identity that already has another primary provider ID.
      p.sportmonks_id is null and p.club=club_name and p.competition=competition_name
       and lower(regexp_replace(p.full_name,'[^[:alnum:]]','','g'))=any(names) as same_club,
      exists(select 1 from public.sportmonks_player_profiles evidence
       where evidence.player_id=p.id
        and evidence.raw_data->>'id'=evidence.sportmonks_id::text
        and dob is not null and evidence.raw_data->>'date_of_birth'=dob
        and v_nationality is not null and evidence.raw_data->>'nationality_id'=v_nationality
        and exists(select 1 from jsonb_array_elements(jsonb_build_array(evidence.raw_data->'name',evidence.raw_data->'display_name',evidence.raw_data->'common_name')) stored_name
         where jsonb_typeof(stored_name)='string'
          and lower(regexp_replace(stored_name#>>'{}','[^[:alnum:]]','','g'))=any(names))) as corroborated,
      exists(select 1 from public.sportmonks_player_profiles evidence where evidence.player_id=p.id
       and ((dob is not null and nullif(evidence.raw_data->>'date_of_birth','') is not null and evidence.raw_data->>'date_of_birth' <> dob)
        or (v_nationality is not null and nullif(evidence.raw_data->>'nationality_id','') is not null and evidence.raw_data->>'nationality_id' <> v_nationality))) as contradicts
     from public.players p
     where (p.api_football_id is not null or p.provider_id like 'sportmonks:%')
      and (lower(regexp_replace(p.full_name,'[^[:alnum:]]','','g'))=any(names)
       or exists(select 1 from public.sportmonks_player_profiles evidence where evidence.player_id=p.id
        and exists(select 1 from jsonb_array_elements(jsonb_build_array(evidence.raw_data->'name',evidence.raw_data->'display_name',evidence.raw_data->'common_name')) stored_name
         where jsonb_typeof(stored_name)='string'
          and lower(regexp_replace(stored_name#>>'{}','[^[:alnum:]]','','g'))=any(names))))
    )
    select coalesce(array_agg(id order by id) filter(where (same_club or corroborated) and not contradicts),'{}'),
     coalesce(array_agg(id order by id),'{}') into candidates,named_candidates from candidate_evidence;
    if cardinality(candidates)=1 then
     matched := candidates[1];
     select case when p.sportmonks_id is null and p.club=club_name and p.competition=competition_name
      then 'exact_club_name' else 'corroborated_profile' end into method from public.players p where p.id=matched;
    elsif cardinality(candidates)>1 then reason := 'ambiguous_name_match';
    elsif cardinality(named_candidates)>0 then reason := 'insufficient_identity_evidence'; candidates := named_candidates;
    else reason := 'no_candidate'; end if;
   end if;
  end if;

  staged := staged || jsonb_build_array(jsonb_build_object('item',item,'index',item_index,'sportmonksId',sm_id,
   'name',display_name,'club',club_name,'competition',competition_name,'matched',matched,'reason',reason,
   'method',method,'candidateIds',to_jsonb(candidates)));
 end loop;

 for proposal in select value from jsonb_array_elements(staged) loop
  item := proposal->'item'; profile := item->'player'; sm_id := (proposal->>'sportmonksId')::bigint;
  matched := (proposal->>'matched')::bigint; reason := proposal->>'reason'; method := proposal->>'method';
  club_name := proposal->>'club'; competition_name := proposal->>'competition';
  if reason is null and method='exact_club_name' and exists(
   select 1 from jsonb_array_elements(staged) other
    where other->>'matched'=matched::text and other->>'sportmonksId' <> sm_id::text) then
   reason := 'ambiguous_batch_identity'; matched := null;
  end if;

  if reason is not null then
   unresolved := unresolved + 1;
   issues := issues || jsonb_build_array(jsonb_build_object('sportmonksId',sm_id,'name',proposal->'name',
    'reason',reason,'candidateIds',proposal->'candidateIds','inputIndex',proposal->'index'));
   -- Cache valid unresolved observations for review, but never erase a reviewed
   -- link or replace evidence on a malformed/contradictory provider observation.
   if reason in ('missing_name','no_candidate','ambiguous_name_match','insufficient_identity_evidence','ambiguous_batch_identity') then
    insert into public.sportmonks_player_profiles(sportmonks_id,player_id,club,competition,raw_data)
    values(sm_id,null,club_name,competition_name,profile)
    on conflict(sportmonks_id) do update set club=excluded.club,competition=excluded.competition,
     raw_data=excluded.raw_data,observed_at=now()
    where public.sportmonks_player_profiles.player_id is null;
   end if;
   continue;
  end if;

  -- Reviewed aliases may legitimately use a second provider ID. Never replace
  -- the canonical primary ID; new matches can fill only an empty primary ID.
  update public.players set sportmonks_id=sm_id where id=matched and sportmonks_id is null;
  -- Sparse roster refreshes must not erase durable DOB/name corroboration.
  select coalesce(jsonb_object_agg(key,value),'{}') into profile from jsonb_each(profile)
   where value <> 'null'::jsonb and not (key in ('name','display_name','common_name','firstname','lastname','image_path')
    and (jsonb_typeof(value) <> 'string' or btrim(value#>>'{}')=''));
  insert into public.sportmonks_player_profiles(sportmonks_id,player_id,club,competition,raw_data)
  values(sm_id,matched,club_name,competition_name,profile)
  on conflict(sportmonks_id) do update set player_id=excluded.player_id,club=excluded.club,
   competition=excluded.competition,raw_data=(case when jsonb_typeof(public.sportmonks_player_profiles.raw_data)='object'
    then public.sportmonks_player_profiles.raw_data else '{}'::jsonb end) || excluded.raw_data,observed_at=now();
  update public.players set
   full_name=coalesce(
    case when jsonb_typeof(profile->'display_name')='string' then nullif(btrim(profile->>'display_name'),'') end,
    case when jsonb_typeof(profile->'common_name')='string' then nullif(btrim(profile->>'common_name'),'') end,full_name),
   photo_url=case when p_names_only then photo_url else coalesce(
    case when jsonb_typeof(profile->'image_path')='string' then nullif(btrim(profile->>'image_path'),'') end,photo_url) end,
   club=case when p_names_only then club else club_name end,
   competition=case when p_names_only then competition else competition_name end
  where id=matched;
  ids := ids || jsonb_build_object(sm_id::text,matched); mapped := mapped + 1;
 end loop;
 return jsonb_build_object('mapped',mapped,'unresolved',unresolved,'playerMap',ids,'issues',issues);
end $$;
revoke all on function public.sync_sportmonks_profiles(jsonb,boolean) from public,anon,authenticated;
grant execute on function public.sync_sportmonks_profiles(jsonb,boolean) to service_role;
