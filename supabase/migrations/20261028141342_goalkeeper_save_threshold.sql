-- Correct saves: 3/4 = 1, 5/6 = 2, 7/8 = 3; each fixture rounds separately.
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
    v_points:=greatest(0,floor((coalesce(p_saves,0)-1)/2.0));
    if v_points<>0 then v_entries:=v_entries||jsonb_build_array(jsonb_build_object('code','saves','label','Saves','detail',coalesce(p_saves,0)||' saves · 1 FP at 3 saves, then +1 for every 2 more','points',v_points)); v_total:=v_total+v_points; end if;
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


  return jsonb_build_object('version','2026-10-28-v4','total',v_total,'entries',v_entries);
end $$;


-- Rule correction only: preserve provider facts, provenance, lineups and autosubs.
-- Lock scores while recapturing finalized snapshots; retain before/after audit.
lock table public.league_player_scores, public.league_matchups,
  public.finalized_gameweek_locks in share row exclusive mode;
create temporary table save_correction_weeks on commit drop as
select distinct s.league_id,s.gameweek
from public.league_player_scores s join public.players p on p.id=s.player_id
where p.position='GK' and s.saves>=3;
create temporary table save_correction_before on commit drop as
select l.league_id,l.gameweek,private.capture_finalized_gameweek(l.league_id,l.gameweek) snapshot
from public.finalized_gameweek_locks l join save_correction_weeks w using(league_id,gameweek);

-- Recalculate shared real-match totals with the canonical database calculator.
update public.football_fixture_player_stats s set source_updated_at=s.source_updated_at
from public.players p where p.id=s.player_id and p.position='GK' and s.saves>=3;

-- Fixture-sum ledgers contain a separate save entry for each match. Correct each
-- entry independently; never round the gameweek's combined saves as one match.
-- Existing canonical (non fixture-sum) rows are recomputed by their row trigger.
do $$
declare v_override text:=current_setting('app.finalized_week_override',true);
begin
  perform set_config('app.finalized_week_override','on',true);
  with corrected as (
    select s.league_id,s.gameweek,s.player_id,
      jsonb_agg(case when e->>'code'='saves' then e || jsonb_build_object(
        'points',greatest(0,floor(((substring(e->>'detail' from '^([0-9]+)'))::numeric-1)/2)),
        'detail',substring(e->>'detail' from '^([0-9]+)') || ' saves · 1 FP at 3 saves, then +1 for every 2 more')
        else e end order by ord) ledger,
      sum(case when e->>'code'='saves' then
        greatest(0,floor(((substring(e->>'detail' from '^([0-9]+)'))::numeric-1)/2))-(e->>'points')::numeric
        else 0 end) delta
    from public.league_player_scores s join public.players p on p.id=s.player_id
    cross join lateral jsonb_array_elements(s.score_ledger) with ordinality entries(e,ord)
    where p.position='GK' and s.saves>=3
    group by s.league_id,s.gameweek,s.player_id
  )
  update public.league_player_scores s
  set fantasy_points=s.fantasy_points+c.delta,score_ledger=c.ledger,updated_at=now()
  from corrected c where s.league_id=c.league_id and s.gameweek=c.gameweek and s.player_id=c.player_id;

  update public.league_matchups m
  set home_score=private.manager_gameweek_score(m.league_id,m.home_user_id,m.gameweek),
      away_score=private.manager_gameweek_score(m.league_id,m.away_user_id,m.gameweek)
  from save_correction_weeks w where m.league_id=w.league_id and m.gameweek=w.gameweek;

  update public.finalized_gameweek_locks l
  set snapshot=private.capture_finalized_gameweek(l.league_id,l.gameweek)
  from save_correction_weeks w where l.league_id=w.league_id and l.gameweek=w.gameweek;
  insert into public.finalized_gameweek_audit(league_id,gameweek,action,reason,before_snapshot,after_snapshot)
  select b.league_id,b.gameweek,'relocked',
    'Owner-requested saves correction: first point at 3 saves, then every 2 more; same rule for every goalkeeper and recorded week.',
    b.snapshot,l.snapshot
  from save_correction_before b join public.finalized_gameweek_locks l using(league_id,gameweek);
  perform set_config('app.finalized_week_override',coalesce(v_override,''),true);
end $$;
