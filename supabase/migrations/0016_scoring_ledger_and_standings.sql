create table public.league_player_scores (
  id bigint generated always as identity primary key,
  league_id uuid not null references public.leagues(id) on delete cascade,
  gameweek smallint not null check (gameweek > 0),
  player_id bigint not null references public.players(id) on delete cascade,
  minutes smallint not null default 0 check (minutes between 0 and 130),
  goals smallint not null default 0 check (goals >= 0),
  assists smallint not null default 0 check (assists >= 0),
  shots_on_target smallint not null default 0 check (shots_on_target >= 0),
  big_chances_missed smallint not null default 0 check (big_chances_missed >= 0),
  completed_passes smallint not null default 0 check (completed_passes >= 0),
  tackles_won smallint not null default 0 check (tackles_won >= 0),
  penalty_goals smallint not null default 0 check (penalty_goals >= 0),
  penalties_missed smallint not null default 0 check (penalties_missed >= 0),
  penalties_conceded smallint not null default 0 check (penalties_conceded >= 0),
  saves smallint not null default 0 check (saves >= 0),
  penalties_saved smallint not null default 0 check (penalties_saved >= 0),
  goals_conceded smallint not null default 0 check (goals_conceded >= 0),
  yellow_cards smallint not null default 0 check (yellow_cards >= 0),
  second_yellow_cards smallint not null default 0 check (second_yellow_cards >= 0),
  red_cards smallint not null default 0 check (red_cards >= 0),
  own_goals smallint not null default 0 check (own_goals >= 0),
  man_of_the_match boolean not null default false,
  status text not null default 'not_started' check (status in ('not_started','live','final')),
  source text not null default 'pending',
  source_updated_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (league_id, gameweek, player_id)
);

create index league_player_scores_lookup_idx on public.league_player_scores(league_id, gameweek, player_id);
alter table public.league_player_scores enable row level security;
grant select on public.league_player_scores to authenticated;

create policy "league members read player scores"
on public.league_player_scores for select to authenticated
using ((select private.is_league_member(league_player_scores.league_id)));

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
    - p_big_chances_missed
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
    - p_own_goals * 3
    + case when p_man_of_the_match then 1 else 0 end;
$$;

create or replace function public.refresh_league_matchup_scores(p_league_id uuid, p_gameweek smallint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if (select auth.uid()) is null or not private.is_league_member(p_league_id) then
    raise exception 'You are not a member of this league';
  end if;

  update public.league_matchups m
  set home_score = coalesce((
        select sum(private.player_score(
          p.position, s.minutes, s.goals, s.assists, s.shots_on_target,
          s.big_chances_missed, s.completed_passes, s.tackles_won,
          s.penalty_goals, s.penalties_missed, s.penalties_conceded,
          s.saves, s.penalties_saved, s.goals_conceded, s.yellow_cards,
          s.second_yellow_cards, s.red_cards, s.own_goals, s.man_of_the_match
        ) + case when lp.is_captain and s.man_of_the_match then 4 else 0 end)
        from public.lineup_players lp
        join public.players p on p.id = lp.player_id
        join public.league_player_scores s on s.league_id = lp.league_id and s.player_id = lp.player_id and s.gameweek = p_gameweek
        where lp.league_id = p_league_id and lp.user_id = m.home_user_id and lp.is_starter
      ), 0),
      away_score = coalesce((
        select sum(private.player_score(
          p.position, s.minutes, s.goals, s.assists, s.shots_on_target,
          s.big_chances_missed, s.completed_passes, s.tackles_won,
          s.penalty_goals, s.penalties_missed, s.penalties_conceded,
          s.saves, s.penalties_saved, s.goals_conceded, s.yellow_cards,
          s.second_yellow_cards, s.red_cards, s.own_goals, s.man_of_the_match
        ) + case when lp.is_captain and s.man_of_the_match then 4 else 0 end)
        from public.lineup_players lp
        join public.players p on p.id = lp.player_id
        join public.league_player_scores s on s.league_id = lp.league_id and s.player_id = lp.player_id and s.gameweek = p_gameweek
        where lp.league_id = p_league_id and lp.user_id = m.away_user_id and lp.is_starter
      ), 0),
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
grant execute on function public.refresh_league_matchup_scores(uuid, smallint) to authenticated;

create or replace function public.league_standings(p_league_id uuid)
returns table(
  rank bigint,
  user_id uuid,
  team_name text,
  played bigint,
  wins bigint,
  draws bigint,
  losses bigint,
  points bigint,
  fantasy_points numeric
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.is_league_member(p_league_id) then
    raise exception 'You are not a member of this league';
  end if;

  return query
  with results as (
    select m.home_user_id as manager_id, m.home_score as scored, m.away_score as conceded
    from public.league_matchups m where m.league_id = p_league_id and m.status = 'final'
    union all
    select m.away_user_id, m.away_score, m.home_score
    from public.league_matchups m where m.league_id = p_league_id and m.status = 'final'
  ), totals as (
    select lm.user_id, lm.team_name,
      count(r.manager_id) as played,
      count(*) filter (where r.scored > r.conceded) as wins,
      count(*) filter (where r.scored = r.conceded) as draws,
      count(*) filter (where r.scored < r.conceded) as losses,
      count(*) filter (where r.scored > r.conceded) * 3 + count(*) filter (where r.scored = r.conceded) as points,
      coalesce(sum(r.scored), 0) as fantasy_points
    from public.league_members lm
    left join results r on r.manager_id = lm.user_id
    where lm.league_id = p_league_id
    group by lm.user_id, lm.team_name
  )
  select row_number() over (order by t.points desc, t.fantasy_points desc, t.team_name),
    t.user_id, t.team_name, t.played, t.wins, t.draws, t.losses, t.points, t.fantasy_points
  from totals t
  order by t.points desc, t.fantasy_points desc, t.team_name;
end;
$$;

revoke all on function public.league_standings(uuid) from public, anon;
grant execute on function public.league_standings(uuid) to authenticated;
