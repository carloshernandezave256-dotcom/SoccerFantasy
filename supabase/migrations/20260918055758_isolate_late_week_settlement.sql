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

create or replace function public.excluded_scoring_leagues()
returns table(league_id uuid) language plpgsql security definer set search_path='' as $$
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Service role required';end if;
 return query select s.league_id from private.gameweek_fixture_sets s
 where exists(select 1 from private.gameweek_scoring_fixtures(s.league_id,s.gameweek))
 and not exists(select 1 from private.gameweek_scoring_fixtures(s.league_id,s.gameweek) f where f.status<>'EXCLUDED')
 and not exists(select 1 from public.finalized_gameweek_locks l where l.league_id=s.league_id and l.gameweek=s.gameweek)
 ;
end;$$;
revoke all on function public.excluded_scoring_leagues() from public,anon,authenticated;
grant execute on function public.excluded_scoring_leagues() to service_role;

