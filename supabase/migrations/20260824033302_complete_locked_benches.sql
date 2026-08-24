-- Keep the complete owned squad in editable lineups and immutable gameweek
-- snapshots. A manager can open My Team as soon as 11 players are drafted;
-- later picks must still be appended to the bench.

create or replace function private.append_draft_pick_to_lineup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_bench_count integer;
begin
  if exists (
    select 1
    from public.lineup_players lineup
    where lineup.league_id = new.league_id
      and lineup.user_id = new.user_id
      and lineup.is_starter
    group by lineup.league_id, lineup.user_id
    having count(*) = 11
  ) and not exists (
    select 1
    from public.lineup_players lineup
    where lineup.league_id = new.league_id
      and lineup.user_id = new.user_id
      and lineup.player_id = new.player_id
  ) then
    select count(*)
    into v_bench_count
    from public.lineup_players lineup
    where lineup.league_id = new.league_id
      and lineup.user_id = new.user_id
      and not lineup.is_starter;

    if v_bench_count < 7 then
      insert into public.lineup_players (
        league_id, user_id, player_id, is_starter, is_captain, bench_order
      ) values (
        new.league_id, new.user_id, new.player_id, false, false, v_bench_count + 1
      ) on conflict (league_id, user_id, player_id) do nothing;
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists append_draft_pick_to_lineup on public.draft_picks;
create trigger append_draft_pick_to_lineup
after insert on public.draft_picks
for each row execute function private.append_draft_pick_to_lineup();

create or replace function private.append_active_pack_card_to_lineup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_bench_count integer;
begin
  if new.active_slot is null then
    return new;
  end if;

  if exists (
    select 1
    from public.lineup_players lineup
    where lineup.league_id = new.league_id
      and lineup.user_id = new.user_id
      and lineup.is_starter
    group by lineup.league_id, lineup.user_id
    having count(*) = 11
  ) and not exists (
    select 1
    from public.lineup_players lineup
    where lineup.league_id = new.league_id
      and lineup.user_id = new.user_id
      and lineup.player_id = new.player_id
  ) then
    select count(*)
    into v_bench_count
    from public.lineup_players lineup
    where lineup.league_id = new.league_id
      and lineup.user_id = new.user_id
      and not lineup.is_starter;

    if v_bench_count < 7 then
      insert into public.lineup_players (
        league_id, user_id, player_id, is_starter, is_captain, bench_order
      ) values (
        new.league_id, new.user_id, new.player_id, false, false, v_bench_count + 1
      ) on conflict (league_id, user_id, player_id) do nothing;
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists append_active_pack_card_to_lineup on public.pack_cards;
create trigger append_active_pack_card_to_lineup
after insert or update of active_slot on public.pack_cards
for each row execute function private.append_active_pack_card_to_lineup();

revoke all on function private.append_draft_pick_to_lineup(),
  private.append_active_pack_card_to_lineup() from public, anon, authenticated;

-- Repair any editable draft lineup that was initialized before all 18 picks.
with missing as (
  select
    picks.league_id,
    picks.user_id,
    picks.player_id,
    row_number() over (
      partition by picks.league_id, picks.user_id
      order by picks.pick_number, picks.player_id
    ) as missing_order,
    (
      select count(*)
      from public.lineup_players bench
      where bench.league_id = picks.league_id
        and bench.user_id = picks.user_id
        and not bench.is_starter
    ) as existing_bench
  from public.draft_picks picks
  where exists (
    select 1
    from public.lineup_players starters
    where starters.league_id = picks.league_id
      and starters.user_id = picks.user_id
      and starters.is_starter
    group by starters.league_id, starters.user_id
    having count(*) = 11
  )
  and not exists (
    select 1
    from public.lineup_players lineup
    where lineup.league_id = picks.league_id
      and lineup.user_id = picks.user_id
      and lineup.player_id = picks.player_id
  )
)
insert into public.lineup_players (
  league_id, user_id, player_id, is_starter, is_captain, bench_order
)
select
  league_id, user_id, player_id, false, false, existing_bench + missing_order
from missing
where missing_order <= greatest(0, 7 - existing_bench)
on conflict (league_id, user_id, player_id) do nothing;

create or replace function private.snapshot_gameweek_lineups(
  p_league_id uuid,
  p_gameweek smallint
)
returns void
language plpgsql
set search_path = ''
as $function$
declare
  v_lock_at timestamptz;
begin
  select transaction_window.roster_lock_at
  into v_lock_at
  from public.league_transaction_windows transaction_window
  where transaction_window.league_id = p_league_id
    and transaction_window.gameweek = p_gameweek
  for update;

  if v_lock_at is not null and now() < v_lock_at then
    return;
  end if;

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
    pitch_order, captured_at
  )
  select
    lineup.league_id, p_gameweek, lineup.user_id, lineup.player_id,
    lineup.is_starter, lineup.is_captain, lineup.pitch_order, now()
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
    pitch_order, captured_at
  )
  select
    league_id, p_gameweek, user_id, player_id, false, false, null, now()
  from missing
  where missing_order <= greatest(0, 7 - existing_bench)
  on conflict do nothing;
end;
$function$;

revoke all on function private.snapshot_gameweek_lineups(uuid, smallint)
from public, anon, authenticated;

-- Repair already-captured draft snapshots only with players drafted before
-- the snapshot was captured.
with snapshot_users as (
  select
    snapshot.league_id,
    snapshot.gameweek,
    snapshot.user_id,
    max(snapshot.captured_at) as captured_at,
    count(*) filter (where not snapshot.is_starter) as existing_bench
  from public.lineup_gameweek_players snapshot
  group by snapshot.league_id, snapshot.gameweek, snapshot.user_id
  having count(*) filter (where snapshot.is_starter) = 11
), missing as (
  select
    users.league_id,
    users.gameweek,
    users.user_id,
    users.existing_bench,
    picks.player_id,
    users.captured_at,
    row_number() over (
      partition by users.league_id, users.gameweek, users.user_id
      order by picks.pick_number, picks.player_id
    ) as missing_order
  from snapshot_users users
  join public.draft_picks picks
    on picks.league_id = users.league_id
   and picks.user_id = users.user_id
   and picks.picked_at <= users.captured_at
  join public.leagues league
    on league.id = users.league_id
   and league.game_format <> 'pack'
  where not exists (
    select 1
    from public.lineup_gameweek_players snapshot
    where snapshot.league_id = users.league_id
      and snapshot.gameweek = users.gameweek
      and snapshot.user_id = users.user_id
      and snapshot.player_id = picks.player_id
  )
)
insert into public.lineup_gameweek_players (
  league_id, gameweek, user_id, player_id, is_starter, is_star_pick,
  pitch_order, captured_at
)
select
  league_id, gameweek, user_id, player_id, false, false, null, captured_at
from missing
where missing_order <= greatest(0, 7 - existing_bench)
on conflict do nothing;
