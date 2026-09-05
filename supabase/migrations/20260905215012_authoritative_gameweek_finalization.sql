-- Freeze scoring membership and require reconciled provider evidence.
-- No historical weeks are backfilled or reopened by this change.
create table private.gameweek_fixture_sets (
  league_id uuid not null references public.leagues(id) on delete cascade,
  gameweek smallint not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  primary key(league_id,gameweek)
);
create table private.gameweek_fixture_members (
  league_id uuid not null,
  gameweek smallint not null,
  fixture_id bigint not null,
  competition text not null,
  official_round smallint not null,
  original_kickoff timestamptz not null,
  primary key(league_id,gameweek,fixture_id),
  foreign key(league_id,gameweek) references private.gameweek_fixture_sets on delete cascade
);
create table private.fixture_stat_evidence (
  fixture_id bigint primary key,
  observed_at timestamptz not null,
  complete boolean not null default false,
  reason text not null,
  player_ids bigint[] not null default '{}'
);
alter table private.gameweek_fixture_sets enable row level security;
alter table private.gameweek_fixture_members enable row level security;
alter table private.fixture_stat_evidence enable row level security;
revoke all on private.gameweek_fixture_sets,private.gameweek_fixture_members,private.fixture_stat_evidence from public,anon,authenticated;
alter table public.league_player_scores add column data_complete boolean not null default false;

-- Persist once at/after the server cutoff. Full season schedule identifies a late
-- old-round fixture by the earlier kickoff of that round, not its new match date.
create or replace function private.freeze_gameweek_fixtures(p_league_id uuid,p_gameweek smallint)
returns void language plpgsql security definer set search_path='' as $$
declare v_lock timestamptz;v_start timestamptz;v_count integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_league_id::text||':'||p_gameweek::text,0));
  if exists(select 1 from public.finalized_gameweek_locks where league_id=p_league_id and gameweek=p_gameweek)
    or exists(select 1 from private.gameweek_fixture_sets where league_id=p_league_id and gameweek=p_gameweek) then return;end if;
  select roster_lock_at into v_lock from public.league_transaction_windows where league_id=p_league_id and gameweek=p_gameweek;
  if v_lock is null or now()<v_lock then return;end if;
  -- Missing an entire competition's schedule must not look like an idle week.
  if exists(
    select 1 from public.leagues l cross join lateral unnest(
      case when l.player_pool='All Top Five' then array['Premier League','La Liga','Serie A','Bundesliga','Ligue 1']
      else array[l.player_pool,l.calendar_competition] end
    ) as required(competition_name)
    where l.id=p_league_id and not exists(select 1 from public.league_headline_fixtures f
      where f.league_id=p_league_id and f.competition=required.competition_name)
  ) then return;end if;
  v_start:=date_trunc('day',v_lock at time zone 'UTC') at time zone 'UTC';
  insert into private.gameweek_fixture_sets values(p_league_id,p_gameweek,v_start,v_start+interval '7 days');
  with rounds as (
    select f.competition,f.gameweek,min(f.kickoff) as first_kickoff,
      count(*) filter(where f.kickoff>=v_start and f.kickoff<v_start+interval '7 days') as inside_count
    from public.league_headline_fixtures f where f.league_id=p_league_id group by f.competition,f.gameweek
  ), chosen as (
    select distinct on (r.competition) r.competition,r.gameweek
    from rounds r join public.leagues l on l.id=p_league_id
    where (l.player_pool='All Top Five' or r.competition=l.player_pool)
      and r.inside_count>0
      and ((r.competition=l.calendar_competition and r.gameweek=p_gameweek)
        or (r.competition<>l.calendar_competition and r.first_kickoff>=v_start and r.first_kickoff<v_start+interval '7 days'))
    order by r.competition,r.inside_count desc,r.gameweek desc
  )
  insert into private.gameweek_fixture_members
  select p_league_id,p_gameweek,f.fixture_id,f.competition,f.gameweek,f.kickoff
  from public.league_headline_fixtures f join chosen c on c.competition=f.competition and c.gameweek=f.gameweek
  where f.league_id=p_league_id and f.kickoff>=v_start and f.kickoff<v_start+interval '7 days';
  get diagnostics v_count=row_count;
  if v_count=0 then delete from private.gameweek_fixture_sets where league_id=p_league_id and gameweek=p_gameweek;end if;
end;$$;

create or replace function private.gameweek_scoring_fixtures(p_league_id uuid,p_gameweek smallint)
returns table(fixture_id bigint,status text) language sql stable security definer set search_path='' as $$
 select m.fixture_id,case
   when f.kickoff<s.starts_at or f.kickoff>=s.ends_at then 'EXCLUDED'
   when now()>=s.ends_at and upper(f.status) in ('PST','CANC','ABD','AWD','WO') then 'EXCLUDED'
   else coalesce(upper(f.status),'UNKNOWN') end
 from private.gameweek_fixture_members m
 join private.gameweek_fixture_sets s using(league_id,gameweek)
 left join public.league_headline_fixtures f on f.league_id=m.league_id and f.fixture_id=m.fixture_id
 where m.league_id=p_league_id and m.gameweek=p_gameweek
$$;

create or replace function private.gameweek_scoring_fixtures_final(p_league_id uuid,p_gameweek smallint)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.gameweek_scoring_fixtures(p_league_id,p_gameweek))
 and not exists(
   select 1 from private.gameweek_scoring_fixtures(p_league_id,p_gameweek) f
   left join private.fixture_stat_evidence e using(fixture_id)
   where f.status<>'EXCLUDED' and (f.status not in ('FT','AET','PEN') or not coalesce(e.complete,false) or cardinality(e.player_ids)=0 or exists(
     select 1 from unnest(e.player_ids) id where not exists(select 1 from public.football_fixture_player_stats stat
       where stat.fixture_id=f.fixture_id and stat.player_id=id and stat.source_updated_at=e.observed_at)
   ))
 )
$$;

-- Remain locked through reconciliation and auto-subs, even if the provider says FT.
create or replace function private.lineup_changes_locked(p_league_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select now()>=w.roster_lock_at and not exists(
   select 1 from public.finalized_gameweek_locks f where f.league_id=p_league_id and f.gameweek=w.gameweek
 ) from public.league_transaction_windows w where w.league_id=p_league_id order by w.gameweek desc limit 1),false)
$$;

create function public.scoring_week_fixtures(p_league_id uuid,p_gameweek smallint)
returns table(fixture_id bigint,status text,kickoff timestamptz,competition text,gameweek smallint,data_complete boolean,evidence_version timestamptz,expected_player_ids bigint[])
language plpgsql security definer set search_path='' as $$
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Service role required';end if;
 perform private.freeze_gameweek_fixtures(p_league_id,p_gameweek);
 return query select f.fixture_id,f.status,m.original_kickoff,m.competition,m.official_round,
   f.status='EXCLUDED' or (f.status in ('FT','AET','PEN') and coalesce(e.complete,false)),e.observed_at,coalesce(e.player_ids,'{}'::bigint[])
 from private.gameweek_scoring_fixtures(p_league_id,p_gameweek) f
 join private.gameweek_fixture_members m on m.league_id=p_league_id and m.gameweek=p_gameweek and m.fixture_id=f.fixture_id
 left join private.fixture_stat_evidence e on e.fixture_id=f.fixture_id;
end;$$;

-- Start each observation as pending before updating status or player rows. A
-- previously complete response cannot certify a later incomplete correction.
create function public.record_fixture_stat_evidence(p_fixture_id bigint,p_observed_at timestamptz,p_complete boolean,p_reason text,p_player_ids bigint[])
returns void language plpgsql security definer set search_path='' as $$
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Service role required';end if;
 insert into private.fixture_stat_evidence values(p_fixture_id,p_observed_at,p_complete,p_reason,p_player_ids)
 on conflict(fixture_id) do update set observed_at=excluded.observed_at,complete=excluded.complete,reason=excluded.reason,player_ids=excluded.player_ids
 where private.fixture_stat_evidence.observed_at<=excluded.observed_at;
end;$$;

revoke all on function private.freeze_gameweek_fixtures(uuid,smallint) from public,anon,authenticated;
revoke all on function public.scoring_week_fixtures(uuid,smallint),public.record_fixture_stat_evidence(bigint,timestamptz,boolean,text,bigint[]) from public,anon,authenticated;
grant execute on function public.scoring_week_fixtures(uuid,smallint),public.record_fixture_stat_evidence(bigint,timestamptz,boolean,text,bigint[]) to service_role;

CREATE OR REPLACE FUNCTION public.settle_final_gameweek(p_league_id uuid, p_gameweek smallint)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_before integer := 0;
  v_inserted integer := 0;
  v_service_request boolean := coalesce((select auth.jwt() ->> 'role'), '') = 'service_role';
begin
  if not v_service_request then raise exception 'Service role required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_league_id::text || ':' || p_gameweek::text, 0));
  if exists (select 1 from public.finalized_gameweek_locks lock where lock.league_id=p_league_id and lock.gameweek=p_gameweek) then return 0; end if;
  perform 1 from private.fixture_stat_evidence e join private.gameweek_fixture_members m using(fixture_id)
    where m.league_id=p_league_id and m.gameweek=p_gameweek order by e.fixture_id for share of e;
  if not private.gameweek_scoring_fixtures_final(p_league_id,p_gameweek) then return 0; end if;
  perform private.snapshot_gameweek_lineups(p_league_id,p_gameweek);
  if exists (
    select 1 from public.lineup_gameweek_players snapshot
    left join public.league_player_scores score on score.league_id=snapshot.league_id and score.gameweek=snapshot.gameweek and score.player_id=snapshot.player_id
    where snapshot.league_id=p_league_id and snapshot.gameweek=p_gameweek and (score.player_id is null or not score.data_complete or score.status<>'final' or score.source_updated_at is null
      or score.source_updated_at<(select max(e.observed_at) from private.fixture_stat_evidence e join private.gameweek_fixture_members m using(fixture_id) where m.league_id=p_league_id and m.gameweek=p_gameweek))
  ) then return 0; end if;
  if not exists(select 1 from public.lineup_gameweek_players where league_id=p_league_id and gameweek=p_gameweek) then return 0;end if;
  select count(*) into v_before from public.lineup_gameweek_substitutions where league_id=p_league_id and gameweek=p_gameweek;
  perform private.apply_gameweek_auto_substitutions(p_league_id,p_gameweek);
  perform public.refresh_league_matchup_scores(p_league_id,p_gameweek);
  select count(*)-v_before into v_inserted from public.lineup_gameweek_substitutions where league_id=p_league_id and gameweek=p_gameweek;
  perform private.lock_finalized_gameweek(p_league_id,p_gameweek);
  perform private.open_next_gameweek(p_league_id,p_gameweek);
  return greatest(v_inserted,0);
end;
$function$;

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

-- Atomically validate the evidence versions, publish the entire league, and
-- settle. A late worker or catch-up request cannot overwrite a finalized week.
create function public.publish_gameweek_scores(p_league_id uuid,p_gameweek smallint,p_rows jsonb,p_evidence jsonb)
returns integer language plpgsql security definer set search_path='' as $$
declare v_count integer;v_ready boolean;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Service role required';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_league_id::text||':'||p_gameweek::text,0));
 if exists(select 1 from public.finalized_gameweek_locks where league_id=p_league_id and gameweek=p_gameweek) then return 0;end if;
 perform private.freeze_gameweek_fixtures(p_league_id,p_gameweek);
 if not exists(select 1 from private.gameweek_fixture_sets where league_id=p_league_id and gameweek=p_gameweek) then raise exception 'Week fixtures are not frozen';end if;
 perform 1 from private.fixture_stat_evidence e join private.gameweek_fixture_members m using(fixture_id)
   where m.league_id=p_league_id and m.gameweek=p_gameweek order by e.fixture_id for share of e;
 if exists(
   (select f.fixture_id,f.status,e.observed_at from private.gameweek_scoring_fixtures(p_league_id,p_gameweek) f
     left join private.fixture_stat_evidence e using(fixture_id)
    except select x.fixture_id,x.status,x.evidence_version from jsonb_to_recordset(p_evidence) x(fixture_id bigint,status text,evidence_version timestamptz))
   union all
   (select x.fixture_id,x.status,x.evidence_version from jsonb_to_recordset(p_evidence) x(fixture_id bigint,status text,evidence_version timestamptz)
    except select f.fixture_id,f.status,e.observed_at from private.gameweek_scoring_fixtures(p_league_id,p_gameweek) f left join private.fixture_stat_evidence e using(fixture_id))
 ) then raise exception 'Fixture evidence changed; retry synchronization';end if;
 if exists(select 1 from jsonb_to_recordset(p_rows) r(league_id uuid,gameweek smallint)
   where r.league_id is distinct from p_league_id or r.gameweek is distinct from p_gameweek) then raise exception 'Score row belongs to another week';end if;
 perform private.snapshot_gameweek_lineups(p_league_id,p_gameweek);
 if exists(select 1 from public.lineup_gameweek_players s where s.league_id=p_league_id and s.gameweek=p_gameweek
   and not exists(select 1 from jsonb_to_recordset(p_rows) r(player_id bigint) where r.player_id=s.player_id)) then raise exception 'Publication omits a locked player';end if;
 v_ready:=private.gameweek_scoring_fixtures_final(p_league_id,p_gameweek);
 -- Server completeness is authoritative, regardless of caller-supplied flags.
 p_rows:=(select coalesce(jsonb_agg(value||jsonb_build_object('data_complete',v_ready,'status',case when v_ready then 'final' else 'live' end)),'[]'::jsonb) from jsonb_array_elements(p_rows));
 insert into public.league_player_scores(league_id,gameweek,player_id,rating,minutes,goals,assists,shots_on_target,big_chances_missed,completed_passes,tackles_won,penalty_goals,penalties_missed,penalties_conceded,saves,penalties_saved,goals_conceded,yellow_cards,second_yellow_cards,red_cards,own_goals,man_of_the_match,stats_received,data_complete,status,source,source_updated_at,updated_at,fantasy_points,score_ledger,calculator_version)
 select league_id,gameweek,player_id,rating,minutes,goals,assists,shots_on_target,big_chances_missed,completed_passes,tackles_won,penalty_goals,penalties_missed,penalties_conceded,saves,penalties_saved,goals_conceded,yellow_cards,second_yellow_cards,red_cards,own_goals,man_of_the_match,stats_received,data_complete,status,source,source_updated_at,updated_at,fantasy_points,score_ledger,calculator_version from jsonb_populate_recordset(null::public.league_player_scores,p_rows)
 on conflict(league_id,gameweek,player_id) do update set rating=excluded.rating,minutes=excluded.minutes,goals=excluded.goals,assists=excluded.assists,shots_on_target=excluded.shots_on_target,big_chances_missed=excluded.big_chances_missed,completed_passes=excluded.completed_passes,tackles_won=excluded.tackles_won,penalty_goals=excluded.penalty_goals,penalties_missed=excluded.penalties_missed,penalties_conceded=excluded.penalties_conceded,saves=excluded.saves,penalties_saved=excluded.penalties_saved,goals_conceded=excluded.goals_conceded,yellow_cards=excluded.yellow_cards,second_yellow_cards=excluded.second_yellow_cards,red_cards=excluded.red_cards,own_goals=excluded.own_goals,man_of_the_match=excluded.man_of_the_match,stats_received=excluded.stats_received,data_complete=excluded.data_complete,status=excluded.status,source=excluded.source,source_updated_at=excluded.source_updated_at,updated_at=excluded.updated_at,fantasy_points=excluded.fantasy_points,score_ledger=excluded.score_ledger,calculator_version=excluded.calculator_version;
 get diagnostics v_count=row_count;
 perform public.refresh_league_matchup_scores(p_league_id,p_gameweek);
 perform public.settle_final_gameweek(p_league_id,p_gameweek);
 return v_count;
end;$$;
revoke all on function public.publish_gameweek_scores(uuid,smallint,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.publish_gameweek_scores(uuid,smallint,jsonb,jsonb) to service_role;

-- Retry unresolved past fixtures at most hourly, ten per tick. They otherwise
-- disappear from the four-hour live window before late provider repairs arrive.
create function public.pending_scoring_fixtures()
returns table(fixture_id bigint,status text,kickoff timestamptz,events_synced_at timestamptz)
language plpgsql security definer set search_path='' as $$
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Service role required';end if;
 return query select c.fixture_id,c.status,c.kickoff,c.events_synced_at
 from public.football_fixture_cache c
 left join private.fixture_stat_evidence e on e.fixture_id=c.fixture_id
 where c.kickoff<now()-interval '4 hours'
   and (e.observed_at is null or e.observed_at<now()-interval '1 hour')
   and exists(select 1 from private.gameweek_fixture_members m
     join private.gameweek_fixture_sets s using(league_id,gameweek)
     where m.fixture_id=c.fixture_id and c.kickoff>=s.starts_at and c.kickoff<s.ends_at
       and not exists(select 1 from public.finalized_gameweek_locks l where l.league_id=m.league_id and l.gameweek=m.gameweek))
 order by e.observed_at nulls first,c.fixture_id limit 10;
end;$$;
revoke all on function public.pending_scoring_fixtures() from public,anon,authenticated;
grant execute on function public.pending_scoring_fixtures() to service_role;

-- No provider request is needed to close a week whose entire frozen set was
-- excluded. Only the scheduler calls this read; catch-up ingestion never does.
create function public.excluded_scoring_leagues()
returns table(league_id uuid) language plpgsql security definer set search_path='' as $$
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Service role required';end if;
 return query select s.league_id from private.gameweek_fixture_sets s
 where exists(select 1 from private.gameweek_scoring_fixtures(s.league_id,s.gameweek))
 and not exists(select 1 from private.gameweek_scoring_fixtures(s.league_id,s.gameweek) f where f.status<>'EXCLUDED')
 and not exists(select 1 from public.finalized_gameweek_locks l where l.league_id=s.league_id and l.gameweek=s.gameweek)
 and s.gameweek=(select max(w.gameweek) from public.league_transaction_windows w where w.league_id=s.league_id);
end;$$;
revoke all on function public.excluded_scoring_leagues() from public,anon,authenticated;
grant execute on function public.excluded_scoring_leagues() to service_role;

CREATE OR REPLACE FUNCTION public.lineup_lock_state(p_league_id uuid)
 RETURNS TABLE(gameweek integer, locks_at timestamp with time zone, reopens_after timestamp with time zone, locked boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not exists(select 1 from public.league_members where league_id=p_league_id and user_id=(select auth.uid())) then
    raise exception 'League membership required';
  end if;
  return query
  select w.gameweek,w.roster_lock_at,max(f.original_kickoff),private.lineup_changes_locked(p_league_id)
  from public.league_transaction_windows w
  left join private.gameweek_fixture_members f on f.league_id=w.league_id and f.gameweek=w.gameweek
  where w.league_id=p_league_id
  group by w.gameweek,w.roster_lock_at
  order by w.gameweek desc limit 1;
end$function$;
