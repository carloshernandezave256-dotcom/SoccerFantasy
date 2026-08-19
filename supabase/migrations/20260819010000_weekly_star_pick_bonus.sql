-- Man of the Match remains an API display award. Fantasy scoring now uses a
-- weekly Star Pick: +5 after the round is final when the selected starter is
-- tied for or alone as that manager's highest-scoring starter.

create table if not exists public.lineup_gameweek_players (
  league_id uuid not null references public.leagues(id) on delete cascade,
  gameweek smallint not null check (gameweek > 0),
  user_id uuid not null references auth.users(id) on delete cascade,
  player_id bigint not null references public.players(id) on delete cascade,
  is_starter boolean not null,
  is_star_pick boolean not null default false,
  pitch_order smallint,
  captured_at timestamptz not null default now(),
  primary key (league_id, gameweek, user_id, player_id)
);

create unique index if not exists lineup_gameweek_one_star_pick_idx
  on public.lineup_gameweek_players(league_id, gameweek, user_id)
  where is_star_pick;

create index if not exists lineup_gameweek_lookup_idx
  on public.lineup_gameweek_players(league_id, gameweek, user_id, is_starter);

alter table public.lineup_gameweek_players enable row level security;
grant select on public.lineup_gameweek_players to authenticated;

drop policy if exists "league members read lineup gameweek snapshots" on public.lineup_gameweek_players;
create policy "league members read lineup gameweek snapshots"
on public.lineup_gameweek_players for select to authenticated
using ((select private.is_league_member(lineup_gameweek_players.league_id)));

create or replace function private.snapshot_gameweek_lineups(
  p_league_id uuid,
  p_gameweek smallint
) returns void
language sql volatile
set search_path = ''
as $$
  insert into public.lineup_gameweek_players(
    league_id, gameweek, user_id, player_id, is_starter, is_star_pick, pitch_order
  )
  select lp.league_id, p_gameweek, lp.user_id, lp.player_id, lp.is_starter, lp.is_captain, lp.pitch_order
  from public.lineup_players lp
  where lp.league_id = p_league_id
    and not exists (
      select 1 from public.lineup_gameweek_players snapshot
      where snapshot.league_id = p_league_id
        and snapshot.gameweek = p_gameweek
        and snapshot.user_id = lp.user_id
    )
  on conflict do nothing;
$$;

revoke all on function private.snapshot_gameweek_lineups(uuid, smallint) from public, anon, authenticated;

create or replace function private.player_score(
  p_position public.player_position,
  p_minutes integer,
  p_goals integer,
  p_assists integer,
  p_shots_on_target integer,
  p_big_chances_missed integer,
  p_completed_passes integer,
  p_tackles_won integer,
  p_penalty_goals integer,
  p_penalties_missed integer,
  p_penalties_conceded integer,
  p_saves integer,
  p_penalties_saved integer,
  p_goals_conceded integer,
  p_yellow_cards integer,
  p_second_yellow_cards integer,
  p_red_cards integer,
  p_own_goals integer,
  p_man_of_the_match boolean
) returns numeric
language sql immutable
set search_path = ''
as $$
  select
    case when p_minutes >= 60 then 2 when p_minutes > 0 then 1 else 0 end
    + p_goals * case p_position when 'GK' then 7 when 'DEF' then 5 when 'MID' then 4 else 3 end
    + case when p_goals >= 3 then case p_position when 'GK' then 9 when 'DEF' then 5 when 'MID' then 3 else 1 end else 0 end
    + p_assists * 2
    + p_shots_on_target
    + floor(p_completed_passes / 10.0)
    + floor(p_tackles_won / 3.0)
    + p_penalty_goals * 2
    - p_penalties_missed * 2
    - p_penalties_conceded * 2
    + case when p_position = 'GK' then floor(p_saves / 3.0) + p_penalties_saved * 2 else 0 end
    + case when p_position in ('GK','DEF') and p_minutes >= 60 and p_goals_conceded = 0 then 3 else 0 end
    + case when p_position in ('GK','DEF') and p_minutes >= 60 and p_goals_conceded >= 2 then -(p_goals_conceded * 2 - 3) else 0 end
    - p_yellow_cards
    - p_second_yellow_cards * 2
    - p_red_cards * 3
    - p_own_goals * 3;
$$;

create or replace function private.manager_gameweek_score(
  p_league_id uuid,
  p_user_id uuid,
  p_gameweek smallint
) returns numeric
language sql stable
set search_path = ''
as $$
  with starter_scores as (
    select
      lp.player_id,
      lp.is_star_pick,
      coalesce(private.player_score(
        p.position, s.minutes, s.goals, s.assists, s.shots_on_target,
        s.big_chances_missed, s.completed_passes, s.tackles_won,
        s.penalty_goals, s.penalties_missed, s.penalties_conceded,
        s.saves, s.penalties_saved, s.goals_conceded, s.yellow_cards,
        s.second_yellow_cards, s.red_cards, s.own_goals, s.man_of_the_match
      ), 0) as base_score
    from public.lineup_gameweek_players lp
    join public.players p on p.id = lp.player_id
    left join public.league_player_scores s
      on s.league_id = lp.league_id
      and s.player_id = lp.player_id
      and s.gameweek = p_gameweek
    where lp.league_id = p_league_id
      and lp.user_id = p_user_id
      and lp.is_starter
  ), round_state as (
    select
      exists (
        select 1 from public.league_player_scores s
        where s.league_id = p_league_id and s.gameweek = p_gameweek
      )
      and not exists (
        select 1 from public.league_player_scores s
        where s.league_id = p_league_id and s.gameweek = p_gameweek and s.status <> 'final'
      ) as settled
  )
  select coalesce(sum(ss.base_score), 0)
    + case when (select settled from round_state)
        and exists (
          select 1 from starter_scores pick
          where pick.is_star_pick
            and pick.base_score = (select max(candidate.base_score) from starter_scores candidate)
        )
      then 5 else 0 end
  from starter_scores ss;
$$;

revoke all on function private.manager_gameweek_score(uuid, uuid, smallint) from public, anon, authenticated;

create or replace function public.refresh_league_matchup_scores(p_league_id uuid, p_gameweek smallint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_service_request boolean := coalesce((select auth.jwt() ->> 'role'), '') = 'service_role';
begin
  if not v_service_request and ((select auth.uid()) is null or not private.is_league_member(p_league_id)) then
    raise exception 'You are not a member of this league';
  end if;

  if exists (
    select 1 from public.league_player_scores s
    where s.league_id = p_league_id and s.gameweek = p_gameweek
  ) then
    perform private.snapshot_gameweek_lineups(p_league_id, p_gameweek);
  end if;

  update public.league_matchups m
  set home_score = private.manager_gameweek_score(p_league_id, m.home_user_id, p_gameweek),
      away_score = private.manager_gameweek_score(p_league_id, m.away_user_id, p_gameweek),
      status = case
        when exists (select 1 from public.league_player_scores s where s.league_id = p_league_id and s.gameweek = p_gameweek and s.status = 'live') then 'live'
        when exists (select 1 from public.league_player_scores s where s.league_id = p_league_id and s.gameweek = p_gameweek)
          and not exists (select 1 from public.league_player_scores s where s.league_id = p_league_id and s.gameweek = p_gameweek and s.status <> 'final') then 'final'
        else 'scheduled'
      end
  where m.league_id = p_league_id and m.gameweek = p_gameweek;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.refresh_league_matchup_scores(uuid, smallint) from public, anon;
grant execute on function public.refresh_league_matchup_scores(uuid, smallint) to authenticated, service_role;
