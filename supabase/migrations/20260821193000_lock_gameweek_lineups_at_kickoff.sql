-- A score cache can contain not-started rows before kickoff. Do not let those
-- rows freeze a manager's lineup before the league's actual roster lock.
create or replace function private.snapshot_gameweek_lineups(
  p_league_id uuid,
  p_gameweek smallint
) returns void
language plpgsql volatile
security invoker
set search_path = ''
as $$
declare
  v_lock_at timestamptz;
begin
  select transaction_window.roster_lock_at
  into v_lock_at
  from public.league_transaction_windows transaction_window
  where transaction_window.league_id = p_league_id
    and transaction_window.gameweek = p_gameweek
  for update;

  -- Cached pre-match score rows may ask for a refresh, but the editable lineup
  -- must remain the source of truth until the league's selected calendar locks.
  if v_lock_at is not null and now() < v_lock_at then
    return;
  end if;

  -- A snapshot captured at or after lock is immutable for that gameweek.
  if v_lock_at is not null and exists (
    select 1
    from public.lineup_gameweek_players snapshot
    where snapshot.league_id = p_league_id
      and snapshot.gameweek = p_gameweek
      and snapshot.captured_at >= v_lock_at
  ) then
    return;
  end if;

  -- Replace any premature snapshot exactly once when the real lock arrives.
  if v_lock_at is not null then
    delete from public.lineup_gameweek_players snapshot
    where snapshot.league_id = p_league_id
      and snapshot.gameweek = p_gameweek;
  end if;

  insert into public.lineup_gameweek_players(
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
end;
$$;

revoke all on function private.snapshot_gameweek_lineups(uuid, smallint)
  from public, anon, authenticated;

-- Repair gameweeks that crossed their lock with a premature snapshot, then
-- immediately reconcile their live matchup totals from the restored lineups.
do $$
declare
  locked record;
begin
  for locked in
    select transaction_window.league_id, transaction_window.gameweek
    from public.league_transaction_windows transaction_window
    where transaction_window.roster_lock_at <= now()
      and exists (
        select 1
        from public.lineup_gameweek_players snapshot
        where snapshot.league_id = transaction_window.league_id
          and snapshot.gameweek = transaction_window.gameweek
          and snapshot.captured_at < transaction_window.roster_lock_at
      )
  loop
    perform private.snapshot_gameweek_lineups(
      locked.league_id, locked.gameweek::smallint
    );

    update public.league_matchups matchup
    set home_score = private.manager_gameweek_score(
          locked.league_id, matchup.home_user_id, locked.gameweek::smallint
        ),
        away_score = private.manager_gameweek_score(
          locked.league_id, matchup.away_user_id, locked.gameweek::smallint
        ),
        status = case
          when exists (
            select 1 from public.league_player_scores score
            where score.league_id = locked.league_id
              and score.gameweek = locked.gameweek
              and score.status = 'live'
          ) then 'live'
          when exists (
            select 1 from public.league_player_scores score
            where score.league_id = locked.league_id
              and score.gameweek = locked.gameweek
          ) and not exists (
            select 1 from public.league_player_scores score
            where score.league_id = locked.league_id
              and score.gameweek = locked.gameweek
              and score.status <> 'final'
          ) then 'final'
          else 'scheduled'
        end
    where matchup.league_id = locked.league_id
      and matchup.gameweek = locked.gameweek;
  end loop;
end;
$$;
