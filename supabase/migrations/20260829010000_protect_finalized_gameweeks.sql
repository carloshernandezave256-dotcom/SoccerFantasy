begin;

create table public.finalized_gameweek_locks (
  league_id uuid not null references public.leagues(id) on delete cascade,
  gameweek smallint not null check (gameweek > 0),
  locked_at timestamptz not null default now(),
  snapshot jsonb not null,
  correction_actor uuid references auth.users(id) on delete set null,
  correction_reason text,
  correction_expires_at timestamptz,
  primary key (league_id, gameweek)
);

create table public.finalized_gameweek_audit (
  id bigint generated always as identity primary key,
  league_id uuid not null references public.leagues(id) on delete cascade,
  gameweek smallint not null,
  action text not null check (action in ('locked','correction_opened','relocked','restored')),
  actor_user_id uuid references auth.users(id) on delete set null,
  reason text,
  before_snapshot jsonb,
  after_snapshot jsonb,
  created_at timestamptz not null default now()
);

create table private.developer_account_emails (
  email text primary key check (email = lower(email))
);

insert into private.developer_account_emails(email)
values ('carloshernandezave256@gmail.com');

alter table public.finalized_gameweek_locks enable row level security;
alter table public.finalized_gameweek_audit enable row level security;
revoke all on public.finalized_gameweek_locks from public, anon, authenticated;
revoke all on public.finalized_gameweek_audit from public, anon, authenticated;

create or replace function private.is_developer_account()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $function$
  select exists (
    select 1
    from private.developer_account_emails developer
    where developer.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$function$;

create or replace function private.capture_finalized_gameweek(
  p_league_id uuid,
  p_gameweek smallint
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select jsonb_build_object(
    'captured_at', now(),
    'league_id', p_league_id,
    'gameweek', p_gameweek,
    'scores', coalesce((
      select jsonb_agg(to_jsonb(score) order by score.player_id)
      from public.league_player_scores score
      where score.league_id = p_league_id and score.gameweek = p_gameweek
    ), '[]'::jsonb),
    'matchups', coalesce((
      select jsonb_agg(to_jsonb(matchup) order by matchup.id)
      from public.league_matchups matchup
      where matchup.league_id = p_league_id and matchup.gameweek = p_gameweek
    ), '[]'::jsonb),
    'lineups', coalesce((
      select jsonb_agg(to_jsonb(lineup) order by lineup.user_id, lineup.player_id)
      from public.lineup_gameweek_players lineup
      where lineup.league_id = p_league_id and lineup.gameweek = p_gameweek
    ), '[]'::jsonb),
    'substitutions', coalesce((
      select jsonb_agg(to_jsonb(substitution) order by substitution.user_id, substitution.outgoing_player_id)
      from public.lineup_gameweek_substitutions substitution
      where substitution.league_id = p_league_id and substitution.gameweek = p_gameweek
    ), '[]'::jsonb)
  );
$function$;

create or replace function private.lock_finalized_gameweek(
  p_league_id uuid,
  p_gameweek smallint
) returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_snapshot jsonb;
begin
  if exists (
    select 1 from public.finalized_gameweek_locks lock
    where lock.league_id = p_league_id and lock.gameweek = p_gameweek
  ) then
    return;
  end if;

  v_snapshot := private.capture_finalized_gameweek(p_league_id, p_gameweek);
  insert into public.finalized_gameweek_locks(league_id, gameweek, snapshot)
  values (p_league_id, p_gameweek, v_snapshot);
  insert into public.finalized_gameweek_audit(
    league_id, gameweek, action, before_snapshot, after_snapshot
  ) values (p_league_id, p_gameweek, 'locked', v_snapshot, v_snapshot);
end;
$function$;

create or replace function private.guard_finalized_gameweek()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_league_id uuid;
  v_gameweek smallint;
  v_actor uuid := auth.uid();
begin
  if tg_op = 'DELETE' then
    v_league_id := old.league_id;
    v_gameweek := old.gameweek;
  else
    v_league_id := new.league_id;
    v_gameweek := new.gameweek;
  end if;
  if coalesce(current_setting('app.finalized_week_override', true), '') = 'on' then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if exists (
    select 1
    from public.finalized_gameweek_locks lock
    where lock.league_id = v_league_id
      and lock.gameweek = v_gameweek
      and not (
        v_actor is not null
        and lock.correction_actor = v_actor
        and lock.correction_expires_at > now()
      )
  ) then
    raise exception 'Fantasy GW % is finalized and locked. Open an owner correction window first.', v_gameweek
      using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$function$;

create trigger guard_finalized_league_player_scores
before insert or update or delete on public.league_player_scores
for each row execute function private.guard_finalized_gameweek();

create trigger guard_finalized_league_matchups
before insert or update or delete on public.league_matchups
for each row execute function private.guard_finalized_gameweek();

create trigger guard_finalized_lineup_gameweek_players
before insert or update or delete on public.lineup_gameweek_players
for each row execute function private.guard_finalized_gameweek();

create trigger guard_finalized_lineup_gameweek_substitutions
before insert or update or delete on public.lineup_gameweek_substitutions
for each row execute function private.guard_finalized_gameweek();

create or replace function public.developer_finalized_gameweek_action(
  p_league_id uuid,
  p_gameweek smallint,
  p_action text,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_before jsonb;
  v_after jsonb;
begin
  if not private.is_developer_account() or v_actor is null then
    raise exception 'Developer access required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_league_id::text || ':' || p_gameweek::text, 0)
  );

  if p_action = 'lock' then
    perform private.lock_finalized_gameweek(p_league_id, p_gameweek);
  elsif p_action = 'unlock' then
    if length(trim(coalesce(p_reason, ''))) < 10 then
      raise exception 'Enter a correction reason of at least 10 characters';
    end if;
    update public.finalized_gameweek_locks lock
    set correction_actor = v_actor,
        correction_reason = trim(p_reason),
        correction_expires_at = now() + interval '15 minutes'
    where lock.league_id = p_league_id and lock.gameweek = p_gameweek
    returning lock.snapshot into v_before;
    if v_before is null then raise exception 'This gameweek is not finalized and locked'; end if;
    insert into public.finalized_gameweek_audit(
      league_id, gameweek, action, actor_user_id, reason, before_snapshot
    ) values (p_league_id, p_gameweek, 'correction_opened', v_actor, trim(p_reason), v_before);
  elsif p_action = 'relock' then
    select lock.snapshot into v_before
    from public.finalized_gameweek_locks lock
    where lock.league_id = p_league_id and lock.gameweek = p_gameweek
      and lock.correction_actor = v_actor and lock.correction_expires_at > now();
    if v_before is null then raise exception 'No active correction window exists'; end if;
    v_after := private.capture_finalized_gameweek(p_league_id, p_gameweek);
    update public.finalized_gameweek_locks lock
    set snapshot = v_after, locked_at = now(), correction_actor = null,
        correction_reason = null, correction_expires_at = null
    where lock.league_id = p_league_id and lock.gameweek = p_gameweek;
    insert into public.finalized_gameweek_audit(
      league_id, gameweek, action, actor_user_id, reason, before_snapshot, after_snapshot
    ) values (p_league_id, p_gameweek, 'relocked', v_actor, p_reason, v_before, v_after);
  elsif p_action = 'restore' then
    select lock.snapshot into v_before
    from public.finalized_gameweek_locks lock
    where lock.league_id = p_league_id and lock.gameweek = p_gameweek;
    if v_before is null then raise exception 'No finalized snapshot exists'; end if;
    v_after := private.capture_finalized_gameweek(p_league_id, p_gameweek);
    perform set_config('app.finalized_week_override', 'on', true);
    delete from public.lineup_gameweek_substitutions where league_id=p_league_id and gameweek=p_gameweek;
    delete from public.lineup_gameweek_players where league_id=p_league_id and gameweek=p_gameweek;
    delete from public.league_player_scores where league_id=p_league_id and gameweek=p_gameweek;
    delete from public.league_matchups where league_id=p_league_id and gameweek=p_gameweek;
    insert into public.league_matchups select * from jsonb_populate_recordset(null::public.league_matchups, v_before -> 'matchups');
    insert into public.league_player_scores select * from jsonb_populate_recordset(null::public.league_player_scores, v_before -> 'scores');
    insert into public.lineup_gameweek_players select * from jsonb_populate_recordset(null::public.lineup_gameweek_players, v_before -> 'lineups');
    insert into public.lineup_gameweek_substitutions select * from jsonb_populate_recordset(null::public.lineup_gameweek_substitutions, v_before -> 'substitutions');
    update public.finalized_gameweek_locks lock
    set correction_actor=null, correction_reason=null, correction_expires_at=null, locked_at=now()
    where lock.league_id=p_league_id and lock.gameweek=p_gameweek;
    insert into public.finalized_gameweek_audit(
      league_id, gameweek, action, actor_user_id, reason, before_snapshot, after_snapshot
    ) values (p_league_id, p_gameweek, 'restored', v_actor, p_reason, v_after, v_before);
  else
    raise exception 'Unknown finalized-gameweek action';
  end if;

  return (
    select jsonb_build_object(
      'leagueId', lock.league_id,
      'gameweek', lock.gameweek,
      'lockedAt', lock.locked_at,
      'correctionExpiresAt', lock.correction_expires_at,
      'correctionReason', lock.correction_reason
    )
    from public.finalized_gameweek_locks lock
    where lock.league_id=p_league_id and lock.gameweek=p_gameweek
  );
end;
$function$;

revoke all on function public.developer_finalized_gameweek_action(uuid,smallint,text,text) from public, anon;
grant execute on function public.developer_finalized_gameweek_action(uuid,smallint,text,text) to authenticated;

create or replace function public.settle_final_gameweek(
  p_league_id uuid,
  p_gameweek smallint
) returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_before integer := 0;
  v_inserted integer := 0;
  v_service_request boolean := coalesce((select auth.jwt() ->> 'role'), '') = 'service_role';
begin
  if not v_service_request then raise exception 'Service role required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_league_id::text || ':' || p_gameweek::text, 0));
  if exists (select 1 from public.finalized_gameweek_locks lock where lock.league_id=p_league_id and lock.gameweek=p_gameweek) then return 0; end if;
  if not private.gameweek_scoring_fixtures_final(p_league_id,p_gameweek) then return 0; end if;
  perform private.snapshot_gameweek_lineups(p_league_id,p_gameweek);
  if exists (
    select 1 from public.lineup_gameweek_players snapshot
    left join public.league_player_scores score on score.league_id=snapshot.league_id and score.gameweek=snapshot.gameweek and score.player_id=snapshot.player_id
    where snapshot.league_id=p_league_id and snapshot.gameweek=p_gameweek and score.player_id is null
  ) then raise exception 'Cannot settle gameweek: one or more locked players are missing score rows'; end if;
  select count(*) into v_before from public.lineup_gameweek_substitutions where league_id=p_league_id and gameweek=p_gameweek;
  update public.league_player_scores set status='final',updated_at=now() where league_id=p_league_id and gameweek=p_gameweek and status<>'final';
  perform private.apply_gameweek_auto_substitutions(p_league_id,p_gameweek);
  perform public.refresh_league_matchup_scores(p_league_id,p_gameweek);
  select count(*)-v_before into v_inserted from public.lineup_gameweek_substitutions where league_id=p_league_id and gameweek=p_gameweek;
  perform private.lock_finalized_gameweek(p_league_id,p_gameweek);
  perform private.open_next_gameweek(p_league_id,p_gameweek);
  return greatest(v_inserted,0);
end;
$function$;

revoke all on function public.settle_final_gameweek(uuid,smallint) from public,anon,authenticated;
grant execute on function public.settle_final_gameweek(uuid,smallint) to service_role;

do $function$
declare completed record;
begin
  for completed in
    select distinct matchup.league_id, matchup.gameweek
    from public.league_matchups matchup
    where matchup.status='final'
  loop
    perform private.lock_finalized_gameweek(completed.league_id,completed.gameweek);
  end loop;
end;
$function$;

commit;
