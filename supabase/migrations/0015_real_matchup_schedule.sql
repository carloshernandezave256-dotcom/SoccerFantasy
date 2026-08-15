create table public.league_matchups (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  gameweek smallint not null check (gameweek between 1 and 50),
  home_user_id uuid not null references public.profiles(id) on delete cascade,
  away_user_id uuid not null references public.profiles(id) on delete cascade,
  home_score numeric(8,2) not null default 0,
  away_score numeric(8,2) not null default 0,
  status text not null default 'scheduled' check (status in ('scheduled','live','final')),
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  check (home_user_id <> away_user_id),
  unique (league_id, gameweek, home_user_id, away_user_id)
);

create index league_matchups_league_week_idx on public.league_matchups(league_id, gameweek);
create index league_matchups_home_user_idx on public.league_matchups(home_user_id);
create index league_matchups_away_user_idx on public.league_matchups(away_user_id);

alter table public.league_matchups enable row level security;
grant select on public.league_matchups to authenticated;

create policy "league members read matchup schedule"
on public.league_matchups
for select
to authenticated
using ((select private.is_league_member(league_matchups.league_id)));

create or replace function public.ensure_league_schedule(p_league_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_users uuid[];
  v_count integer;
  v_slots integer;
  v_rounds integer;
  v_round integer;
  v_pair integer;
  v_first uuid;
  v_second uuid;
begin
  if v_user is null or not exists (
    select 1 from public.league_members
    where league_id = p_league_id and user_id = v_user
  ) then
    raise exception 'League membership required';
  end if;

  perform 1 from public.leagues where id = p_league_id for update;

  if exists (select 1 from public.league_matchups where league_id = p_league_id) then
    return (select count(*)::integer from public.league_matchups where league_id = p_league_id);
  end if;

  select array_agg(user_id order by draft_slot nulls last, joined_at)
  into v_users
  from public.league_members
  where league_id = p_league_id;

  v_count := coalesce(cardinality(v_users), 0);
  if v_count < 2 then raise exception 'At least two managers are required'; end if;

  if mod(v_count, 2) = 1 then v_users := array_append(v_users, null::uuid); end if;
  v_slots := cardinality(v_users);
  v_rounds := v_slots - 1;

  for v_round in 1..v_rounds loop
    for v_pair in 1..(v_slots / 2) loop
      v_first := v_users[v_pair];
      v_second := v_users[v_slots - v_pair + 1];
      if v_first is not null and v_second is not null then
        if mod(v_round + v_pair, 2) = 0 then
          insert into public.league_matchups(league_id, gameweek, home_user_id, away_user_id)
          values (p_league_id, v_round, v_first, v_second);
          insert into public.league_matchups(league_id, gameweek, home_user_id, away_user_id)
          values (p_league_id, v_round + v_rounds, v_second, v_first);
        else
          insert into public.league_matchups(league_id, gameweek, home_user_id, away_user_id)
          values (p_league_id, v_round, v_second, v_first);
          insert into public.league_matchups(league_id, gameweek, home_user_id, away_user_id)
          values (p_league_id, v_round + v_rounds, v_first, v_second);
        end if;
      end if;
    end loop;
    v_users := array[v_users[1], v_users[v_slots]] || v_users[2:v_slots-1];
  end loop;

  return (select count(*)::integer from public.league_matchups where league_id = p_league_id);
end
$$;

revoke all on function public.ensure_league_schedule(uuid) from public, anon;
grant execute on function public.ensure_league_schedule(uuid) to authenticated;
