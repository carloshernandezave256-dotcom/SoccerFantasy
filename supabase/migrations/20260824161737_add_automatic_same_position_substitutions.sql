begin;

create table public.lineup_gameweek_substitutions (
  league_id uuid not null references public.leagues(id) on delete cascade,
  gameweek smallint not null check (gameweek > 0),
  user_id uuid not null references auth.users(id) on delete cascade,
  outgoing_player_id bigint not null references public.players(id) on delete cascade,
  incoming_player_id bigint not null references public.players(id) on delete cascade,
  position public.player_position not null,
  outgoing_pitch_order smallint,
  incoming_bench_order smallint,
  incoming_points numeric not null,
  applied_at timestamptz not null default now(),
  carried_to_lineup_at timestamptz,
  primary key (league_id, gameweek, user_id, outgoing_player_id),
  unique (league_id, gameweek, user_id, incoming_player_id),
  check (outgoing_player_id <> incoming_player_id)
);

create index lineup_gameweek_substitutions_lookup_idx
  on public.lineup_gameweek_substitutions (league_id, gameweek, user_id);

alter table public.lineup_gameweek_substitutions enable row level security;
revoke all on table public.lineup_gameweek_substitutions from anon;
grant select on table public.lineup_gameweek_substitutions to authenticated;

create policy "league members read automatic substitutions"
on public.lineup_gameweek_substitutions
for select
to authenticated
using ((select private.is_league_member(league_id)));

create or replace function private.apply_gameweek_auto_substitutions(
  p_league_id uuid,
  p_gameweek smallint
) returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_inserted integer := 0;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_league_id::text || ':' || p_gameweek::text, 0)
  );
  perform private.snapshot_gameweek_lineups(p_league_id, p_gameweek);

  -- A provider can mark a partial payload final. Do not apply substitutions until
  -- every player in every locked lineup has a stored final score row.
  if not exists (
    select 1 from public.lineup_gameweek_players snapshot
    where snapshot.league_id = p_league_id and snapshot.gameweek = p_gameweek
  ) or exists (
    select 1
    from public.lineup_gameweek_players snapshot
    left join public.league_player_scores score
      on score.league_id = snapshot.league_id
     and score.gameweek = snapshot.gameweek
     and score.player_id = snapshot.player_id
    where snapshot.league_id = p_league_id
      and snapshot.gameweek = p_gameweek
      and (score.player_id is null or score.status <> 'final')
  ) then
    return 0;
  end if;

  with outgoing as (
    select
      snapshot.user_id,
      snapshot.player_id,
      player.position,
      snapshot.pitch_order,
      row_number() over (
        partition by snapshot.user_id, player.position
        order by snapshot.pitch_order nulls last, snapshot.player_id
      ) as replacement_rank
    from public.lineup_gameweek_players snapshot
    join public.players player on player.id = snapshot.player_id
    join public.league_player_scores score
      on score.league_id = snapshot.league_id
     and score.gameweek = snapshot.gameweek
     and score.player_id = snapshot.player_id
    where snapshot.league_id = p_league_id
      and snapshot.gameweek = p_gameweek
      and snapshot.is_starter
      and score.status = 'final'
      and score.minutes = 0
  ), incoming as (
    select
      snapshot.user_id,
      snapshot.player_id,
      player.position,
      score.fantasy_points,
      editable.bench_order,
      row_number() over (
        partition by snapshot.user_id, player.position
        order by score.fantasy_points desc,
          editable.bench_order nulls last,
          snapshot.player_id
      ) as replacement_rank
    from public.lineup_gameweek_players snapshot
    join public.players player on player.id = snapshot.player_id
    join public.league_player_scores score
      on score.league_id = snapshot.league_id
     and score.gameweek = snapshot.gameweek
     and score.player_id = snapshot.player_id
    left join public.lineup_players editable
      on editable.league_id = snapshot.league_id
     and editable.user_id = snapshot.user_id
     and editable.player_id = snapshot.player_id
    where snapshot.league_id = p_league_id
      and snapshot.gameweek = p_gameweek
      and not snapshot.is_starter
      and score.status = 'final'
      and score.minutes > 0
  )
  insert into public.lineup_gameweek_substitutions (
    league_id, gameweek, user_id,
    outgoing_player_id, incoming_player_id, position,
    outgoing_pitch_order, incoming_bench_order, incoming_points
  )
  select
    p_league_id, p_gameweek, outgoing.user_id,
    outgoing.player_id, incoming.player_id, outgoing.position,
    outgoing.pitch_order, incoming.bench_order, incoming.fantasy_points
  from outgoing
  join incoming
    on incoming.user_id = outgoing.user_id
   and incoming.position = outgoing.position
   and incoming.replacement_rank = outgoing.replacement_rank
  on conflict do nothing;

  get diagnostics v_inserted = row_count;

  update public.lineup_gameweek_players snapshot
  set is_starter = false,
      is_star_pick = false,
      pitch_order = null
  from public.lineup_gameweek_substitutions substitution
  where substitution.league_id = p_league_id
    and substitution.gameweek = p_gameweek
    and snapshot.league_id = substitution.league_id
    and snapshot.gameweek = substitution.gameweek
    and snapshot.user_id = substitution.user_id
    and snapshot.player_id = substitution.outgoing_player_id;

  update public.lineup_gameweek_players snapshot
  set is_starter = true,
      is_star_pick = false,
      pitch_order = substitution.outgoing_pitch_order
  from public.lineup_gameweek_substitutions substitution
  where substitution.league_id = p_league_id
    and substitution.gameweek = p_gameweek
    and snapshot.league_id = substitution.league_id
    and snapshot.gameweek = substitution.gameweek
    and snapshot.user_id = substitution.user_id
    and snapshot.player_id = substitution.incoming_player_id;

  -- Carry the exact same-position swap into My Team as next week's default.
  -- Clear both occupied slots first so immediate unique indexes cannot collide.
  update public.lineup_players lineup
  set pitch_order = null,
      bench_order = null,
      is_starter = case
        when lineup.player_id = substitution.incoming_player_id then true
        else false
      end,
      is_captain = false,
      updated_at = now()
  from public.lineup_gameweek_substitutions substitution
  where substitution.league_id = p_league_id
    and substitution.gameweek = p_gameweek
    and substitution.carried_to_lineup_at is null
    and lineup.league_id = substitution.league_id
    and lineup.user_id = substitution.user_id
    and lineup.player_id in (
      substitution.outgoing_player_id,
      substitution.incoming_player_id
    );

  update public.lineup_players lineup
  set pitch_order = case
        when lineup.player_id = substitution.incoming_player_id
          then substitution.outgoing_pitch_order
        else null
      end,
      bench_order = case
        when lineup.player_id = substitution.outgoing_player_id
          then substitution.incoming_bench_order
        else null
      end,
      updated_at = now()
  from public.lineup_gameweek_substitutions substitution
  where substitution.league_id = p_league_id
    and substitution.gameweek = p_gameweek
    and substitution.carried_to_lineup_at is null
    and lineup.league_id = substitution.league_id
    and lineup.user_id = substitution.user_id
    and lineup.player_id in (
      substitution.outgoing_player_id,
      substitution.incoming_player_id
    );

  update public.lineup_gameweek_substitutions substitution
  set carried_to_lineup_at = now()
  where substitution.league_id = p_league_id
    and substitution.gameweek = p_gameweek
    and substitution.carried_to_lineup_at is null
    and exists (
      select 1 from public.lineup_players incoming
      where incoming.league_id = substitution.league_id
        and incoming.user_id = substitution.user_id
        and incoming.player_id = substitution.incoming_player_id
        and incoming.is_starter
    )
    and exists (
      select 1 from public.lineup_players outgoing
      where outgoing.league_id = substitution.league_id
        and outgoing.user_id = substitution.user_id
        and outgoing.player_id = substitution.outgoing_player_id
        and not outgoing.is_starter
    );

  return v_inserted;
end;
$function$;

revoke all on function private.apply_gameweek_auto_substitutions(uuid, smallint)
from public, anon, authenticated;

create or replace function private.apply_final_score_auto_substitutions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.status = 'final' then
    perform private.apply_gameweek_auto_substitutions(
      new.league_id, new.gameweek::smallint
    );
  end if;
  return new;
end;
$function$;

drop trigger if exists apply_final_score_auto_substitutions
on public.league_player_scores;
create trigger apply_final_score_auto_substitutions
after insert or update of status, minutes, fantasy_points
on public.league_player_scores
for each row execute function private.apply_final_score_auto_substitutions();

revoke all on function private.apply_final_score_auto_substitutions()
from public, anon, authenticated;

-- User-saved lineups cannot contain a player currently marked unavailable.
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
  if v_mid < 1 or v_fwd < 1 then raise exception 'Starting XI requires at least one midfielder and one forward'; end if;
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

create or replace function public.initialize_default_lineup(
  p_league_id uuid,
  p_starters bigint[],
  p_bench bigint[]
) returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := (select auth.uid());
  v_format text;
  v_gk integer;
  v_def integer;
  v_mid integer;
  v_fwd integer;
  v_existing integer;
  v_owned integer;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select league.game_format into v_format
  from public.league_members member
  join public.leagues league on league.id = member.league_id
  where member.league_id = p_league_id and member.user_id = v_user;
  if v_format is null then raise exception 'League membership required'; end if;
  if private.lineup_changes_locked(p_league_id) then
    raise exception 'Your full lineup is locked until every fixture in this gameweek is final';
  end if;

  select
    count(*) filter (where lineup.is_starter),
    count(*) filter (where lineup.is_starter and player.position = 'GK'),
    count(*) filter (where lineup.is_starter and player.position = 'DEF'),
    count(*) filter (where lineup.is_starter and player.position = 'MID'),
    count(*) filter (where lineup.is_starter and player.position = 'FWD')
  into v_existing, v_gk, v_def, v_mid, v_fwd
  from public.lineup_players lineup
  join public.players player on player.id = lineup.player_id
  where lineup.league_id = p_league_id and lineup.user_id = v_user;
  if v_existing = 11 and v_gk = 1 and v_def >= 3 and v_mid >= 1 and v_fwd between 1 and 4 then
    return false;
  end if;

  if cardinality(p_starters) <> 11 or cardinality(p_bench) > 7 then
    raise exception 'Default lineup requires 11 starters and at most 7 bench players';
  end if;
  if cardinality(p_starters || p_bench) <> cardinality(array(select distinct unnest(p_starters || p_bench))) then
    raise exception 'A player cannot occupy two lineup slots';
  end if;
  if exists (select 1 from public.players where id = any(p_starters) and injured) then
    raise exception 'Injured, suspended, or unavailable players cannot start';
  end if;

  select
    count(*) filter (where position = 'GK'),
    count(*) filter (where position = 'DEF'),
    count(*) filter (where position = 'MID'),
    count(*) filter (where position = 'FWD')
  into v_gk, v_def, v_mid, v_fwd
  from public.players where id = any(p_starters);
  if v_gk <> 1 or v_def <> 4 or v_mid <> 3 or v_fwd <> 3 then
    raise exception 'The automatic lineup must be a 4-3-3 with exactly one goalkeeper';
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
    raise exception 'Every default lineup player must be in your active squad';
  end if;

  delete from public.lineup_players
  where league_id = p_league_id and user_id = v_user;
  insert into public.lineup_players (
    league_id, user_id, player_id, is_starter, is_captain, pitch_order
  ) select p_league_id, v_user, player_id, true, false, ordinal
    from unnest(p_starters) with ordinality starter(player_id, ordinal);
  insert into public.lineup_players (
    league_id, user_id, player_id, is_starter, is_captain, bench_order
  ) select p_league_id, v_user, player_id, false, false, ordinal
    from unnest(p_bench) with ordinality bench(player_id, ordinal);
  return true;
end;
$function$;

create or replace function public.set_lineup_captain(
  p_league_id uuid,
  p_captain bigint
) returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.league_members
    where league_id = p_league_id and user_id = v_user
  ) then raise exception 'League membership required'; end if;
  if private.lineup_changes_locked(p_league_id) then
    raise exception 'Your full lineup is locked until every fixture in this gameweek is final';
  end if;
  if not exists (
    select 1 from public.lineup_players lineup
    join public.players player on player.id = lineup.player_id
    where lineup.league_id = p_league_id
      and lineup.user_id = v_user
      and lineup.player_id = p_captain
      and lineup.is_starter
      and not player.injured
  ) then
    raise exception 'Your captain must be an available player in the starting eleven';
  end if;
  update public.lineup_players set is_captain = false
  where league_id = p_league_id and user_id = v_user and is_captain;
  update public.lineup_players set is_captain = true
  where league_id = p_league_id and user_id = v_user
    and player_id = p_captain and is_starter;
end;
$function$;

revoke all on function public.save_lineup(uuid, bigint[], bigint[], bigint),
  public.initialize_default_lineup(uuid, bigint[], bigint[]),
  public.set_lineup_captain(uuid, bigint)
from public, anon;
grant execute on function public.save_lineup(uuid, bigint[], bigint[], bigint),
  public.initialize_default_lineup(uuid, bigint[], bigint[]),
  public.set_lineup_captain(uuid, bigint)
to authenticated;

commit;
