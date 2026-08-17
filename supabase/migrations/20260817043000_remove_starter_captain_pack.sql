-- Starter bundles open as two packs: one guaranteed Superstar and 21 regular cards.
-- Removing the captain dependency prevents the entire atomic claim from failing
-- when a league-specific captain is not present in the current API player pool.
create or replace function public.claim_pack_starter(p_league_id uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare
  v_user uuid := (select auth.uid());
  v_open uuid;
  v_ids bigint[] := '{}';
  v_id bigint;
  v_pos public.player_position;
  v_need int;
  v_pool text;
begin
  select l.player_pool into v_pool
  from public.league_members m
  join public.leagues l on l.id=m.league_id
  where m.league_id=p_league_id
    and m.user_id=v_user
    and l.game_format='pack';

  if v_pool is null then
    raise exception 'Pack League membership required';
  end if;
  if exists(select 1 from public.pack_cards where league_id=p_league_id and user_id=v_user) then
    raise exception 'Starter bundle already claimed';
  end if;

  insert into public.pack_openings(league_id,user_id,pack_type)
  values(p_league_id,v_user,'starter')
  returning id into v_open;

  if v_pool='La Liga' then
    select id into v_id from public.players
    where active and competition='La Liga' and full_name='Lamine Yamal'
    limit 1;
  elsif v_pool='All Top Five' then
    select id into v_id from public.players
    where active and full_name='Erling Haaland'
    limit 1;
  else
    select id into v_id from public.players
    where active and competition=v_pool and draft_rank<=50
    order by random()
    limit 1;
  end if;

  if v_id is null then
    raise exception 'Superstar pool is not ready';
  end if;
  insert into public.pack_cards(league_id,user_id,player_id,acquired_via,opening_id)
  values(p_league_id,v_user,v_id,'starter_superstar',v_open);
  v_ids:=array_append(v_ids,v_id);

  foreach v_pos in array array['GK','DEF','MID','FWD']::public.player_position[] loop
    v_need:=case v_pos when 'GK' then 2 when 'DEF' then 6 when 'MID' then 6 else 4 end;
    for v_id in
      select id from public.players
      where active
        and position=v_pos
        and not(id=any(v_ids))
        and (v_pool='All Top Five' or competition=v_pool)
      order by random()
      limit v_need
    loop
      insert into public.pack_cards(league_id,user_id,player_id,acquired_via,opening_id)
      values(p_league_id,v_user,v_id,'starter_regular',v_open);
      v_ids:=array_append(v_ids,v_id);
    end loop;
  end loop;

  while cardinality(v_ids)<22 loop
    select id into v_id from public.players
    where active
      and not(id=any(v_ids))
      and (v_pool='All Top Five' or competition=v_pool)
    order by random()
    limit 1;
    if v_id is null then
      raise exception 'This player pool does not contain enough active players';
    end if;
    insert into public.pack_cards(league_id,user_id,player_id,acquired_via,opening_id)
    values(p_league_id,v_user,v_id,'starter_regular',v_open);
    v_ids:=array_append(v_ids,v_id);
  end loop;

  update public.pack_wallets
  set coins=500,updated_at=now()
  where league_id=p_league_id and user_id=v_user;
  return cardinality(v_ids);
end$$;

revoke all on function public.claim_pack_starter(uuid) from public,anon;
grant execute on function public.claim_pack_starter(uuid) to authenticated;
