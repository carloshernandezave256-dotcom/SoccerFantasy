alter table public.league_player_scores
  drop constraint league_player_scores_minutes_check;

alter table public.league_player_scores
  add constraint league_player_scores_minutes_check
  check (minutes >= 0 and minutes <= 1000);

create or replace function private.calculate_league_player_row()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
declare v_position text; v_result jsonb;
begin
  if new.source='api-football-fixture-sum'
     and new.calculator_version='fixture-sum-v1'
     and new.score_ledger is not null then
    return new;
  end if;
  select p.position::text into v_position from public.players p where p.id=new.player_id;
  v_result:=private.calculate_fantasy_score(v_position,new.minutes,new.goals,new.assists,new.shots_on_target,
    new.completed_passes,new.tackles_won,new.penalty_goals,new.penalties_missed,new.penalties_conceded,
    new.saves,new.penalties_saved,new.goals_conceded,new.yellow_cards,new.second_yellow_cards,new.red_cards,
    new.own_goals,new.man_of_the_match,new.status='final');
  new.fantasy_points:=(v_result->>'total')::numeric;
  new.score_ledger:=v_result->'entries';
  new.calculator_version:=v_result->>'version';
  return new;
end
$function$;
