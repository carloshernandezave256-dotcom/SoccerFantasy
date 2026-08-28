begin;

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

commit;
