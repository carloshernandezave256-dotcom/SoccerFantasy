-- Freeze manager-selected priorities alongside the weekly XI. Historical rows stay unchanged.
alter table public.lineup_gameweek_players add column bench_order smallint;

CREATE OR REPLACE FUNCTION private.snapshot_gameweek_lineups(p_league_id uuid, p_gameweek smallint)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_lock_at timestamptz;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_league_id::text||':'||p_gameweek::text,0));
  select transaction_window.roster_lock_at
  into v_lock_at
  from public.league_transaction_windows transaction_window
  where transaction_window.league_id = p_league_id
    and transaction_window.gameweek = p_gameweek
  for update;

  if v_lock_at is not null and now() < v_lock_at then
    return;
  end if;

  perform private.freeze_gameweek_fixtures(p_league_id,p_gameweek);

  if v_lock_at is not null and exists (
    select 1
    from public.lineup_gameweek_players snapshot
    where snapshot.league_id = p_league_id
      and snapshot.gameweek = p_gameweek
      and snapshot.captured_at >= v_lock_at
  ) then
    return;
  end if;

  if v_lock_at is not null then
    delete from public.lineup_gameweek_players snapshot
    where snapshot.league_id = p_league_id
      and snapshot.gameweek = p_gameweek;
  end if;

  insert into public.lineup_gameweek_players (
    league_id, gameweek, user_id, player_id, is_starter, is_star_pick,
    pitch_order, bench_order, captured_at
  )
  select
    lineup.league_id, p_gameweek, lineup.user_id, lineup.player_id,
    lineup.is_starter, lineup.is_captain, lineup.pitch_order, lineup.bench_order, now()
  from public.lineup_players lineup
  where lineup.league_id = p_league_id
    and not exists (
      select 1
      from public.lineup_gameweek_players snapshot
      where snapshot.league_id = p_league_id
        and snapshot.gameweek = p_gameweek
        and snapshot.user_id = lineup.user_id
    )
  on conflict do nothing;

  -- Defense in depth: include every active owned player even if an older or
  -- partially initialized editable lineup omitted a bench row.
  with owned as (
    select picks.league_id, picks.user_id, picks.player_id, picks.pick_number::bigint as squad_order
    from public.draft_picks picks
    join public.leagues league on league.id = picks.league_id
    where picks.league_id = p_league_id
      and league.game_format <> 'pack'
    union all
    select distinct cards.league_id, cards.user_id, cards.player_id, cards.active_slot::bigint
    from public.pack_cards cards
    join public.leagues league on league.id = cards.league_id
    where cards.league_id = p_league_id
      and league.game_format = 'pack'
      and cards.active_slot is not null
  ), missing as (
    select
      owned.*,
      row_number() over (
        partition by owned.league_id, owned.user_id
        order by owned.squad_order, owned.player_id
      ) as missing_order,
      (
        select count(*)
        from public.lineup_gameweek_players bench
        where bench.league_id = owned.league_id
          and bench.gameweek = p_gameweek
          and bench.user_id = owned.user_id
          and not bench.is_starter
      ) as existing_bench
    from owned
    where exists (
      select 1
      from public.lineup_gameweek_players starters
      where starters.league_id = owned.league_id
        and starters.gameweek = p_gameweek
        and starters.user_id = owned.user_id
        and starters.is_starter
      group by starters.league_id, starters.gameweek, starters.user_id
      having count(*) = 11
    )
    and not exists (
      select 1
      from public.lineup_gameweek_players snapshot
      where snapshot.league_id = owned.league_id
        and snapshot.gameweek = p_gameweek
        and snapshot.user_id = owned.user_id
        and snapshot.player_id = owned.player_id
    )
  )
  insert into public.lineup_gameweek_players (
    league_id, gameweek, user_id, player_id, is_starter, is_star_pick,
    pitch_order, bench_order, captured_at
  )
  select
    league_id, p_gameweek, user_id, player_id, false, false, null, (existing_bench + missing_order)::smallint, now()
  from missing
  where missing_order <= greatest(0, 7 - existing_bench)
  on conflict do nothing;
end;
$function$;

-- Protect new-week lineup edits while older provider evidence remains pending.
CREATE OR REPLACE FUNCTION private.apply_gameweek_auto_substitution_settlement(p_league_id uuid, p_gameweek smallint)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      and (score.player_id is null or score.status <> 'final' or not score.data_complete or score.source_updated_at is null
        or score.source_updated_at<(select max(e.observed_at) from private.fixture_stat_evidence e join private.gameweek_fixture_members m using(fixture_id) where m.league_id=p_league_id and m.gameweek=p_gameweek))
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
      snapshot.bench_order,
      row_number() over (
        partition by snapshot.user_id, player.position
        order by snapshot.bench_order nulls last,
          case when snapshot.bench_order is null then score.fantasy_points end desc,
          snapshot.player_id
      ) as replacement_rank
    from public.lineup_gameweek_players snapshot
    join public.players player on player.id = snapshot.player_id
    join public.league_player_scores score
      on score.league_id = snapshot.league_id
     and score.gameweek = snapshot.gameweek
     and score.player_id = snapshot.player_id
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

  -- A reopened next-week market owns the editable lineup now. Settle only
  -- the historical snapshot; never carry late substitutions into that lineup.
  if exists(select 1 from public.league_transaction_windows
    where league_id=p_league_id and gameweek>p_gameweek) then
    return v_inserted;
  end if;

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
