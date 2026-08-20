create table if not exists public.score_sync_locks (
  league_id uuid primary key references public.leagues(id) on delete cascade,
  locked_until timestamptz not null,
  last_attempt_at timestamptz not null default now()
);

alter table public.score_sync_locks enable row level security;
revoke all on table public.score_sync_locks from anon, authenticated;

create or replace function public.acquire_score_sync_lock(
  p_league_id uuid,
  p_cooldown_seconds integer default 120
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_rows integer := 0;
begin
  insert into public.score_sync_locks (league_id, locked_until, last_attempt_at)
  values (
    p_league_id,
    now() + make_interval(secs => greatest(p_cooldown_seconds, 60)),
    now()
  )
  on conflict (league_id) do update
  set locked_until = excluded.locked_until,
      last_attempt_at = excluded.last_attempt_at
  where public.score_sync_locks.locked_until <= now();

  get diagnostics affected_rows = row_count;
  return affected_rows = 1;
end;
$$;

revoke all on function public.acquire_score_sync_lock(uuid, integer) from public, anon, authenticated;
grant execute on function public.acquire_score_sync_lock(uuid, integer) to service_role;
