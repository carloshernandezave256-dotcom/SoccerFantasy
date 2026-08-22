-- Raw provider statistics enter once. This calculator produces the only
-- authoritative base fantasy total and itemized ledger consumed by the app.
create or replace function private.calculate_fantasy_score(
  p_position text, p_minutes integer, p_goals integer, p_assists integer,
  p_shots_on_target integer, p_completed_passes integer, p_tackles_won integer,
  p_penalty_goals integer, p_penalties_missed integer, p_penalties_conceded integer,
  p_saves integer, p_penalties_saved integer, p_goals_conceded integer,
  p_yellow_cards integer, p_second_yellow_cards integer, p_red_cards integer,
  p_own_goals integer, p_man_of_the_match boolean, p_is_final boolean
) returns jsonb
language plpgsql immutable set search_path=''
as $$
declare
  v_entries jsonb='[]'::jsonb;
  v_total numeric=0;
  v_points numeric;
  v_goals integer=greatest(coalesce(p_goals,0),0);
  v_penalty_goals integer=least(greatest(coalesce(p_penalty_goals,0),0),greatest(coalesce(p_goals,0),0));
  v_open_goals integer;
  v_goal_value integer=case p_position when 'GK' then 7 when 'DEF' then 5 when 'MID' then 4 else 3 end;
  v_hat_base integer=case p_position when 'GK' then 9 when 'DEF' then 5 when 'MID' then 3 else 1 end;
  v_clean_sheet integer=case p_position when 'GK' then 3 when 'DEF' then 3 when 'MID' then 1 else 0 end;
begin
  v_open_goals:=greatest(v_goals-v_penalty_goals,0);

  v_points:=case when coalesce(p_minutes,0)>=60 then 2 when coalesce(p_minutes,0)>0 then 1 else 0 end;
  if v_points<>0 then v_entries:=v_entries||jsonb_build_array(jsonb_build_object('code','minutes','label','Playing time','detail',coalesce(p_minutes,0)||' minutes','points',v_points)); v_total:=v_total+v_points; end if;

  v_points:=v_open_goals*v_goal_value;
  if v_points<>0 then v_entries:=v_entries||jsonb_build_array(jsonb_build_object('code','goals','label','Non-penalty goals','detail',v_open_goals||' non-penalty goal'||case when v_open_goals=1 then '' else 's' end||' · '||v_goal_value||' FP each for a '||p_position,'points',v_points)); v_total:=v_total+v_points; end if;

  if v_goals>=3 then
    v_points:=v_hat_base+least(v_penalty_goals,3)*(v_goal_value-2);
    v_entries:=v_entries||jsonb_build_array(jsonb_build_object('code','hat-trick','label','Hat-trick bonus','detail',v_goals||' goals including penalties · '||v_points||' FP bonus for a '||p_position,'points',v_points)); v_total:=v_total+v_points;
  end if;

  v_points:=greatest(coalesce(p_assists,0),0)*2;
  if v_points<>0 then v_entries:=v_entries||jsonb_build_array(jsonb_build_object('code','assists','label','Assists','detail',coalesce(p_assists,0)||' assist'||case when coalesce(p_assists,0)=1 then '' else 's' end||' · 2 FP each','points',v_points)); v_total:=v_total+v_points; end if;

  v_points:=floor(greatest(coalesce(p_shots_on_target,0),0)/3.0);
  if v_points<>0 then v_entries:=v_entries||jsonb_build_array(jsonb_build_object('code','shots-on-target','label','Shots on target','detail',coalesce(p_shots_on_target,0)||' shots on target · 1 FP for every 3','points',v_points)); v_total:=v_total+v_points; end if;

  v_points:=floor(greatest(coalesce(p_completed_passes,0),0)/10.0);
  if v_points<>0 then v_entries:=v_entries||jsonb_build_array(jsonb_build_object('code','passes','label','Completed passes','detail',coalesce(p_completed_passes,0)||' completed passes · 1 FP for every 10','points',v_points)); v_total:=v_total+v_points; end if;

  v_points:=floor(greatest(coalesce(p_tackles_won,0),0)/3.0);
  if v_points<>0 then v_entries:=v_entries||jsonb_build_array(jsonb_build_object('code','tackles','label','Tackles won','detail',coalesce(p_tackles_won,0)||' tackles won · 1 FP for every 3','points',v_points)); v_total:=v_total+v_points; end if;

  v_points:=v_penalty_goals*2;
  if v_points<>0 then v_entries:=v_entries||jsonb_build_array(jsonb_build_object('code','penalty-goals','label','Penalty goals','detail',v_penalty_goals||' penalties scored · 2 FP each, regardless of position','points',v_points)); v_total:=v_total+v_points; end if;

  v_points:=-greatest(coalesce(p_penalties_missed,0),0)*2;
  if v_points<>0 then v_entries:=v_entries||jsonb_build_array(jsonb_build_object('code','penalties-missed','label','Penalties missed','detail',coalesce(p_penalties_missed,0)||' penalties missed · −2 FP each','points',v_points)); v_total:=v_total+v_points; end if;

  v_points:=-greatest(coalesce(p_penalties_conceded,0),0)*2;
  if v_points<>0 then v_entries:=v_entries||jsonb_build_array(jsonb_build_object('code','penalties-conceded','label','Penalties conceded','detail',coalesce(p_penalties_conceded,0)||' penalties conceded · −2 FP each','points',v_points)); v_total:=v_total+v_points; end if;

  if p_position='GK' then
    v_points:=floor(greatest(coalesce(p_saves,0),0)/3.0);
    if v_points<>0 then v_entries:=v_entries||jsonb_build_array(jsonb_build_object('code','saves','label','Saves','detail',coalesce(p_saves,0)||' saves · 1 FP for every 3','points',v_points)); v_total:=v_total+v_points; end if;
    v_points:=greatest(coalesce(p_penalties_saved,0),0)*2;
    if v_points<>0 then v_entries:=v_entries||jsonb_build_array(jsonb_build_object('code','penalties-saved','label','Penalties saved','detail',coalesce(p_penalties_saved,0)||' penalties saved · 2 FP each','points',v_points)); v_total:=v_total+v_points; end if;
  end if;

  if coalesce(p_is_final,false) and coalesce(p_minutes,0)>0 and coalesce(p_goals_conceded,0)=0 and v_clean_sheet<>0 then
    v_points:=v_clean_sheet;
    v_entries:=v_entries||jsonb_build_array(jsonb_build_object('code','clean-sheet','label','Clean sheet','detail','Team finished with a clean sheet · '||v_points||' FP for any appearance as a '||p_position,'points',v_points)); v_total:=v_total+v_points;
  end if;

  if p_position in ('GK','DEF') and coalesce(p_minutes,0)>=60 and coalesce(p_goals_conceded,0)>=2 then
    v_points:=-(coalesce(p_goals_conceded,0)*2-3);
    v_entries:=v_entries||jsonb_build_array(jsonb_build_object('code','goals-conceded','label','Goals conceded','detail',coalesce(p_goals_conceded,0)||' goals conceded · deductions begin at 2','points',v_points)); v_total:=v_total+v_points;
  end if;

  v_points:=-greatest(coalesce(p_yellow_cards,0),0);
  if v_points<>0 then v_entries:=v_entries||jsonb_build_array(jsonb_build_object('code','yellow','label','Yellow cards','detail',coalesce(p_yellow_cards,0)||' yellow cards · −1 FP each','points',v_points)); v_total:=v_total+v_points; end if;
  v_points:=-greatest(coalesce(p_second_yellow_cards,0),0)*2;
  if v_points<>0 then v_entries:=v_entries||jsonb_build_array(jsonb_build_object('code','second-yellow','label','Second-yellow dismissals','detail',coalesce(p_second_yellow_cards,0)||' second-yellow dismissals · −2 FP each','points',v_points)); v_total:=v_total+v_points; end if;
  v_points:=-greatest(coalesce(p_red_cards,0),0)*3;
  if v_points<>0 then v_entries:=v_entries||jsonb_build_array(jsonb_build_object('code','red','label','Straight red cards','detail',coalesce(p_red_cards,0)||' straight red cards · −3 FP each','points',v_points)); v_total:=v_total+v_points; end if;
  v_points:=-greatest(coalesce(p_own_goals,0),0)*3;
  if v_points<>0 then v_entries:=v_entries||jsonb_build_array(jsonb_build_object('code','own-goals','label','Own goals','detail',coalesce(p_own_goals,0)||' own goals · −3 FP each','points',v_points)); v_total:=v_total+v_points; end if;

  if coalesce(p_man_of_the_match,false) then
    v_points:=2; v_entries:=v_entries||jsonb_build_array(jsonb_build_object('code','motm','label','Man of the Match','detail','Man of the Match · 2 FP','points',v_points)); v_total:=v_total+v_points;
  end if;

  return jsonb_build_object('version','2026-08-22-v1','total',v_total,'entries',v_entries);
end $$;

create or replace function private.fantasy_points(
  p_position text, p_minutes integer, p_goals integer, p_assists integer,
  p_shots_on_target integer, p_completed_passes integer, p_tackles_won integer,
  p_penalty_goals integer, p_penalties_missed integer, p_penalties_conceded integer,
  p_saves integer, p_penalties_saved integer, p_goals_conceded integer,
  p_yellow_cards integer, p_second_yellow_cards integer, p_red_cards integer,
  p_own_goals integer, p_man_of_the_match boolean, p_is_final boolean
) returns numeric language sql immutable set search_path='' as $$
  select (private.calculate_fantasy_score(p_position,p_minutes,p_goals,p_assists,p_shots_on_target,
    p_completed_passes,p_tackles_won,p_penalty_goals,p_penalties_missed,p_penalties_conceded,
    p_saves,p_penalties_saved,p_goals_conceded,p_yellow_cards,p_second_yellow_cards,p_red_cards,
    p_own_goals,p_man_of_the_match,p_is_final)->>'total')::numeric;
$$;

alter table public.football_fixture_player_stats add column if not exists fantasy_points numeric not null default 0;
alter table public.football_fixture_player_stats add column if not exists score_ledger jsonb not null default '[]'::jsonb;
alter table public.football_fixture_player_stats add column if not exists calculator_version text not null default '2026-08-22-v1';
alter table public.league_player_scores add column if not exists fantasy_points numeric not null default 0;
alter table public.league_player_scores add column if not exists score_ledger jsonb not null default '[]'::jsonb;
alter table public.league_player_scores add column if not exists calculator_version text not null default '2026-08-22-v1';

create or replace function private.calculate_fixture_player_row() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_position text; v_final boolean; v_result jsonb;
begin
  select p.position::text into v_position from public.players p where p.id=new.player_id;
  select lower(f.status) in ('final','ft','aet','pen') into v_final from public.football_fixture_cache f where f.fixture_id=new.fixture_id;
  v_result:=private.calculate_fantasy_score(v_position,new.minutes,new.goals,new.assists,new.shots_on_target,
    new.completed_passes,new.tackles_won,new.penalty_goals,new.penalties_missed,new.penalties_conceded,
    new.saves,new.penalties_saved,new.goals_conceded,new.yellow_cards,0,new.red_cards,0,new.man_of_the_match,coalesce(v_final,false));
  new.fantasy_points:=(v_result->>'total')::numeric; new.score_ledger:=v_result->'entries'; new.calculator_version:=v_result->>'version'; return new;
end $$;

create or replace function private.calculate_league_player_row() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_position text; v_result jsonb;
begin
  select p.position::text into v_position from public.players p where p.id=new.player_id;
  v_result:=private.calculate_fantasy_score(v_position,new.minutes,new.goals,new.assists,new.shots_on_target,
    new.completed_passes,new.tackles_won,new.penalty_goals,new.penalties_missed,new.penalties_conceded,
    new.saves,new.penalties_saved,new.goals_conceded,new.yellow_cards,new.second_yellow_cards,new.red_cards,
    new.own_goals,new.man_of_the_match,new.status='final');
  new.fantasy_points:=(v_result->>'total')::numeric; new.score_ledger:=v_result->'entries'; new.calculator_version:=v_result->>'version'; return new;
end $$;

drop trigger if exists calculate_fixture_player_score on public.football_fixture_player_stats;
create trigger calculate_fixture_player_score before insert or update on public.football_fixture_player_stats for each row execute function private.calculate_fixture_player_row();
drop trigger if exists calculate_league_player_score on public.league_player_scores;
create trigger calculate_league_player_score before insert or update on public.league_player_scores for each row execute function private.calculate_league_player_row();

-- Re-run every stored row through the one calculator.
update public.football_fixture_player_stats set source_updated_at=source_updated_at;
update public.league_player_scores set updated_at=updated_at;

create or replace function private.manager_gameweek_score(p_league_id uuid,p_user_id uuid,p_gameweek smallint)
returns numeric language sql stable set search_path='' as $$
  select coalesce(sum(coalesce(s.fantasy_points,0)*(case when l.is_star_pick then 1.5 else 1 end)),0)
  from public.lineup_gameweek_players l
  left join public.league_player_scores s on s.league_id=l.league_id and s.player_id=l.player_id and s.gameweek=l.gameweek
  where l.league_id=p_league_id and l.gameweek=p_gameweek and l.user_id=p_user_id and l.is_starter;
$$;

create or replace function public.player_season_totals()
returns table(player_id bigint,points bigint,appearances bigint,minutes bigint,goals bigint,assists bigint,
  shots_on_target bigint,completed_passes bigint,tackles_won bigint,saves bigint,clean_sheets bigint,
  yellow_cards bigint,red_cards bigint,motm bigint,latest_gameweek integer,latest_status text)
language plpgsql stable security definer set search_path='' as $$
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  return query
  with current_season as (select case when extract(month from now())<=6 then extract(year from now())::integer-1 else extract(year from now())::integer end season),
  matches as (select s.*,f.gameweek,f.status,f.kickoff from public.football_fixture_player_stats s join public.football_fixture_cache f using(fixture_id) join current_season cs on cs.season=f.season),
  latest as (select distinct on(m.player_id) m.player_id,m.gameweek,m.status from matches m order by m.player_id,m.kickoff desc)
  select p.id,coalesce(sum(m.fantasy_points),0)::bigint,count(*) filter(where m.minutes>0)::bigint,
    coalesce(sum(m.minutes),0)::bigint,coalesce(sum(m.goals),0)::bigint,coalesce(sum(m.assists),0)::bigint,
    coalesce(sum(m.shots_on_target),0)::bigint,coalesce(sum(m.completed_passes),0)::bigint,
    coalesce(sum(m.tackles_won),0)::bigint,coalesce(sum(m.saves),0)::bigint,
    count(*) filter(where lower(m.status) in ('final','ft','aet','pen') and m.minutes>0 and m.goals_conceded=0)::bigint,
    coalesce(sum(m.yellow_cards),0)::bigint,coalesce(sum(m.red_cards),0)::bigint,
    count(*) filter(where m.man_of_the_match)::bigint,l.gameweek,l.status
  from public.players p left join matches m on m.player_id=p.id left join latest l on l.player_id=p.id
  where p.active and m.player_id is not null group by p.id,l.gameweek,l.status;
end $$;

create or replace function public.player_season_history(p_player_id bigint)
returns table(fixture_id bigint,gameweek integer,kickoff timestamptz,status text,home_team text,away_team text,
  home_score integer,away_score integer,rating numeric,minutes integer,goals integer,assists integer,
  shots_on_target integer,completed_passes integer,tackles_won integer,saves integer,goals_conceded integer,
  yellow_cards integer,red_cards integer,man_of_the_match boolean,points integer)
language plpgsql stable security definer set search_path='' as $$
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  return query select f.fixture_id,f.gameweek,f.kickoff,f.status,f.home_team,f.away_team,f.home_score,f.away_score,
    s.rating,s.minutes::integer,s.goals::integer,s.assists::integer,s.shots_on_target::integer,
    s.completed_passes::integer,s.tackles_won::integer,s.saves::integer,s.goals_conceded::integer,
    s.yellow_cards::integer,s.red_cards::integer,s.man_of_the_match,s.fantasy_points::integer
  from public.football_fixture_player_stats s join public.football_fixture_cache f using(fixture_id)
  where s.player_id=p_player_id and f.season=case when extract(month from now())<=6 then extract(year from now())::integer-1 else extract(year from now())::integer end
  order by f.kickoff desc;
end $$;

update public.league_matchups m set home_score=private.manager_gameweek_score(m.league_id,m.home_user_id,m.gameweek),away_score=private.manager_gameweek_score(m.league_id,m.away_user_id,m.gameweek)
where exists(select 1 from public.league_player_scores s where s.league_id=m.league_id and s.gameweek=m.gameweek);
