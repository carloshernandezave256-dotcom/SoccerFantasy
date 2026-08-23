-- Midfielders keep their raw tackle statistics, but tackles do not score
-- fantasy points and never appear in their scoring ledger.
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

  if p_position<>'MID' then
    v_points:=floor(greatest(coalesce(p_tackles_won,0),0)/3.0);
    if v_points<>0 then v_entries:=v_entries||jsonb_build_array(jsonb_build_object('code','tackles','label','Tackles won','detail',coalesce(p_tackles_won,0)||' tackles won · 1 FP for every 3','points',v_points)); v_total:=v_total+v_points; end if;
  end if;

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

  return jsonb_build_object('version','2026-08-23-v2','total',v_total,'entries',v_entries);
end $$;

alter table public.football_fixture_player_stats alter column calculator_version set default '2026-08-23-v2';
alter table public.league_player_scores alter column calculator_version set default '2026-08-23-v2';

-- Fire the existing canonical row triggers so every stored fixture and league
-- score is recalculated immediately with the new position rule.
update public.football_fixture_player_stats set source_updated_at=source_updated_at;
update public.league_player_scores set updated_at=updated_at;

-- Reconcile every already-created matchup after the player totals change.
update public.league_matchups m
set home_score=private.manager_gameweek_score(m.league_id,m.home_user_id,m.gameweek),
    away_score=private.manager_gameweek_score(m.league_id,m.away_user_id,m.gameweek)
where exists (
  select 1 from public.league_player_scores s
  where s.league_id=m.league_id and s.gameweek=m.gameweek
);
