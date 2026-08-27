create or replace function public.save_lineup(
  p_league_id uuid,
  p_starters bigint[],
  p_bench bigint[],
  p_captain bigint
) returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := (select auth.uid());
  v_gk integer;
  v_def integer;
  v_mid integer;
  v_fwd integer;
  v_owned integer;
  v_format text;
begin
  select league.game_format into v_format
  from public.league_members member
  join public.leagues league on league.id = member.league_id
  where member.league_id = p_league_id and member.user_id = v_user;
  if v_format is null then raise exception 'League membership required'; end if;
  if private.lineup_changes_locked(p_league_id) then
    raise exception 'Your full lineup is locked until every fixture in this gameweek is final';
  end if;
  if cardinality(p_starters) <> 11 then raise exception 'A starting lineup requires exactly 11 players'; end if;
  if cardinality(p_bench) > 7 then raise exception 'The bench allows at most 7 players'; end if;
  if not p_captain = any(p_starters) then raise exception 'Your captain must be in the starting XI'; end if;
  if cardinality(p_starters || p_bench) <> cardinality(array(select distinct unnest(p_starters || p_bench))) then
    raise exception 'A player cannot occupy two lineup slots';
  end if;
  if exists (select 1 from public.players where id = any(p_starters) and injured) then
    raise exception 'Injured, suspended, or unavailable players cannot start';
  end if;

  if v_format = 'pack' then
    select count(distinct player_id) into v_owned
    from public.pack_cards
    where league_id = p_league_id and user_id = v_user
      and active_slot is not null and player_id = any(p_starters || p_bench);
  else
    select count(*) into v_owned
    from public.draft_picks
    where league_id = p_league_id and user_id = v_user
      and player_id = any(p_starters || p_bench);
  end if;
  if v_owned <> cardinality(p_starters || p_bench) then
    raise exception 'Every lineup player must be in your active squad';
  end if;

  select
    count(*) filter (where position = 'GK'),
    count(*) filter (where position = 'DEF'),
    count(*) filter (where position = 'MID'),
    count(*) filter (where position = 'FWD')
  into v_gk, v_def, v_mid, v_fwd
  from public.players where id = any(p_starters);
  if v_gk <> 1 then raise exception 'Starting XI requires exactly one goalkeeper'; end if;
  if v_def < 3 then raise exception 'Starting XI requires at least three defenders'; end if;
  if v_mid < 2 then raise exception 'Starting XI requires at least two midfielders'; end if;
  if v_fwd < 1 then raise exception 'Starting XI requires at least one forward'; end if;
  if v_fwd > 4 then raise exception 'Starting XI allows at most four forwards'; end if;

  delete from public.lineup_players
  where league_id = p_league_id and user_id = v_user;
  insert into public.lineup_players (
    league_id, user_id, player_id, is_starter, is_captain, pitch_order
  ) select p_league_id, v_user, player_id, true, player_id = p_captain, ordinal
    from unnest(p_starters) with ordinality starter(player_id, ordinal);
  insert into public.lineup_players (
    league_id, user_id, player_id, is_starter, bench_order, is_captain
  ) select p_league_id, v_user, player_id, false, ordinal, false
    from unnest(p_bench) with ordinality bench(player_id, ordinal);
end;
$function$;

update public.lineup_players
set bench_order = null
where league_id = '9dec3905-0882-46a8-a5a5-d87c79c3ac9c'
  and user_id = '85e3f8d9-3ad6-4994-b2ff-2f4b1ca9bd32'
  and player_id = 2239;

update public.lineup_players
set pitch_order = null
where league_id = '9dec3905-0882-46a8-a5a5-d87c79c3ac9c'
  and user_id = '85e3f8d9-3ad6-4994-b2ff-2f4b1ca9bd32'
  and player_id = 1276;

update public.lineup_players
set is_starter = true, pitch_order = 8, is_captain = false
where league_id = '9dec3905-0882-46a8-a5a5-d87c79c3ac9c'
  and user_id = '85e3f8d9-3ad6-4994-b2ff-2f4b1ca9bd32'
  and player_id = 2239;

update public.lineup_players
set is_starter = false, bench_order = 1, is_captain = false
where league_id = '9dec3905-0882-46a8-a5a5-d87c79c3ac9c'
  and user_id = '85e3f8d9-3ad6-4994-b2ff-2f4b1ca9bd32'
  and player_id = 1276;
