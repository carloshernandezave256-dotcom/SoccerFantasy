alter table public.lineup_players add column if not exists is_captain boolean not null default false;
create unique index if not exists lineup_one_captain_idx on public.lineup_players(league_id,user_id) where is_captain;

drop function if exists public.save_lineup(uuid,bigint[],bigint[]);
create function public.save_lineup(p_league_id uuid,p_starters bigint[],p_bench bigint[],p_captain bigint)
returns void language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_gk int;v_def int;v_mid int;v_fwd int;v_owned int;
begin
  if not exists(select 1 from public.league_members where league_id=p_league_id and user_id=v_user) then raise exception 'League membership required';end if;
  if cardinality(p_starters)<>11 then raise exception 'A starting lineup requires exactly 11 players';end if;
  if cardinality(p_bench)>7 then raise exception 'The bench allows at most 7 players';end if;
  if not p_captain=any(p_starters) then raise exception 'Your captain must be in the starting XI';end if;
  if cardinality(p_starters||p_bench)<>cardinality(array(select distinct unnest(p_starters||p_bench))) then raise exception 'A player cannot occupy two lineup slots';end if;
  select count(*) into v_owned from public.draft_picks where league_id=p_league_id and user_id=v_user and player_id=any(p_starters||p_bench);
  if v_owned<>cardinality(p_starters||p_bench) then raise exception 'Every lineup player must be owned by your team';end if;
  select count(*) filter(where position='GK'),count(*) filter(where position='DEF'),count(*) filter(where position='MID'),count(*) filter(where position='FWD') into v_gk,v_def,v_mid,v_fwd from public.players where id=any(p_starters);
  if v_gk<>1 then raise exception 'Starting XI requires exactly one goalkeeper';end if;
  if v_def<3 then raise exception 'Starting XI requires at least three defenders';end if;
  if v_mid<1 or v_fwd<1 then raise exception 'Starting XI requires at least one midfielder and one forward';end if;
  delete from public.lineup_players where league_id=p_league_id and user_id=v_user;
  insert into public.lineup_players(league_id,user_id,player_id,is_starter,is_captain) select p_league_id,v_user,x,true,x=p_captain from unnest(p_starters) x;
  insert into public.lineup_players(league_id,user_id,player_id,is_starter,bench_order,is_captain) select p_league_id,v_user,x,false,ord,false from unnest(p_bench) with ordinality b(x,ord);
end$$;
revoke all on function public.save_lineup(uuid,bigint[],bigint[],bigint) from public,anon;
grant execute on function public.save_lineup(uuid,bigint[],bigint[],bigint) to authenticated;
