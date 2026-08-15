alter table public.lineup_players
  add column if not exists pitch_order smallint check (pitch_order between 1 and 11);

create unique index if not exists lineup_players_unique_pitch_order_idx
  on public.lineup_players(league_id, user_id, pitch_order)
  where pitch_order is not null;

create or replace function public.save_lineup(p_league_id uuid,p_starters bigint[],p_bench bigint[],p_captain bigint)
returns void language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_gk int;v_def int;v_mid int;v_fwd int;v_owned int;v_format text;
begin
  select l.game_format into v_format from public.league_members m join public.leagues l on l.id=m.league_id where m.league_id=p_league_id and m.user_id=v_user;
  if v_format is null then raise exception 'League membership required';end if;
  if cardinality(p_starters)<>11 then raise exception 'A starting lineup requires exactly 11 players';end if;
  if cardinality(p_bench)>7 then raise exception 'The bench allows at most 7 players';end if;
  if not p_captain=any(p_starters) then raise exception 'Your captain must be in the starting XI';end if;
  if cardinality(p_starters||p_bench)<>cardinality(array(select distinct unnest(p_starters||p_bench))) then raise exception 'A player cannot occupy two lineup slots';end if;
  if v_format='pack' then select count(distinct player_id) into v_owned from public.pack_cards where league_id=p_league_id and user_id=v_user and active_slot is not null and player_id=any(p_starters||p_bench);
  else select count(*) into v_owned from public.draft_picks where league_id=p_league_id and user_id=v_user and player_id=any(p_starters||p_bench);end if;
  if v_owned<>cardinality(p_starters||p_bench) then raise exception 'Every lineup player must be in your active squad';end if;
  select count(*) filter(where position='GK'),count(*) filter(where position='DEF'),count(*) filter(where position='MID'),count(*) filter(where position='FWD') into v_gk,v_def,v_mid,v_fwd from public.players where id=any(p_starters);
  if v_gk<>1 then raise exception 'Starting XI requires exactly one goalkeeper';end if;if v_def<3 then raise exception 'Starting XI requires at least three defenders';end if;if v_mid<1 or v_fwd<1 then raise exception 'Starting XI requires at least one midfielder and one forward';end if;
  delete from public.lineup_players where league_id=p_league_id and user_id=v_user;
  insert into public.lineup_players(league_id,user_id,player_id,is_starter,is_captain,pitch_order)
    select p_league_id,v_user,x,true,x=p_captain,ord from unnest(p_starters) with ordinality s(x,ord);
  insert into public.lineup_players(league_id,user_id,player_id,is_starter,bench_order,is_captain)
    select p_league_id,v_user,x,false,ord,false from unnest(p_bench) with ordinality b(x,ord);
end$$;

revoke all on function public.save_lineup(uuid,bigint[],bigint[],bigint) from public,anon;
grant execute on function public.save_lineup(uuid,bigint[],bigint[],bigint) to authenticated;
