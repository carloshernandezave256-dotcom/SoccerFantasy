create or replace function public.import_api_test_scores(p_league_id uuid,p_gameweek smallint,p_scores jsonb)
returns integer language plpgsql security definer set search_path='' as $$
declare v_count integer;
begin
  if not exists(select 1 from public.leagues where id=p_league_id and commissioner_id=(select auth.uid())) then raise exception 'Only the commissioner can load test scores';end if;
  if p_gameweek<1 then raise exception 'Gameweek must be at least 1';end if;
  if jsonb_typeof(p_scores)<>'array' or jsonb_array_length(p_scores)>200 then raise exception 'Invalid score payload';end if;
  insert into public.league_player_scores(league_id,gameweek,player_id,minutes,goals,assists,shots_on_target,big_chances_missed,completed_passes,tackles_won,penalty_goals,penalties_missed,penalties_conceded,saves,penalties_saved,goals_conceded,yellow_cards,second_yellow_cards,red_cards,own_goals,man_of_the_match,status,source,source_updated_at,updated_at)
  select p_league_id,p_gameweek,x.player_id,x.minutes,x.goals,x.assists,x.shots_on_target,x.big_chances_missed,x.completed_passes,x.tackles_won,x.penalty_goals,x.penalties_missed,x.penalties_conceded,x.saves,x.penalties_saved,x.goals_conceded,x.yellow_cards,x.second_yellow_cards,x.red_cards,x.own_goals,false,'final','api-football-test',now(),now()
  from jsonb_to_recordset(p_scores) as x(player_id bigint,minutes smallint,goals smallint,assists smallint,shots_on_target smallint,big_chances_missed smallint,completed_passes smallint,tackles_won smallint,penalty_goals smallint,penalties_missed smallint,penalties_conceded smallint,saves smallint,penalties_saved smallint,goals_conceded smallint,yellow_cards smallint,second_yellow_cards smallint,red_cards smallint,own_goals smallint)
  where exists(select 1 from public.draft_picks dp where dp.league_id=p_league_id and dp.player_id=x.player_id)
  on conflict(league_id,gameweek,player_id) do update set minutes=excluded.minutes,goals=excluded.goals,assists=excluded.assists,shots_on_target=excluded.shots_on_target,big_chances_missed=excluded.big_chances_missed,completed_passes=excluded.completed_passes,tackles_won=excluded.tackles_won,penalty_goals=excluded.penalty_goals,penalties_missed=excluded.penalties_missed,penalties_conceded=excluded.penalties_conceded,saves=excluded.saves,penalties_saved=excluded.penalties_saved,goals_conceded=excluded.goals_conceded,yellow_cards=excluded.yellow_cards,second_yellow_cards=excluded.second_yellow_cards,red_cards=excluded.red_cards,own_goals=excluded.own_goals,man_of_the_match=false,status='final',source='api-football-test',source_updated_at=now(),updated_at=now();
  get diagnostics v_count=row_count;return v_count;
end$$;

create or replace function public.clear_api_test_scores(p_league_id uuid,p_gameweek smallint)
returns integer language plpgsql security definer set search_path='' as $$
declare v_count integer;
begin
  if not exists(select 1 from public.leagues where id=p_league_id and commissioner_id=(select auth.uid())) then raise exception 'Only the commissioner can clear test scores';end if;
  delete from public.league_player_scores where league_id=p_league_id and gameweek=p_gameweek and source='api-football-test';
  get diagnostics v_count=row_count;return v_count;
end$$;

revoke all on function public.import_api_test_scores(uuid,smallint,jsonb),public.clear_api_test_scores(uuid,smallint) from public,anon;
grant execute on function public.import_api_test_scores(uuid,smallint,jsonb),public.clear_api_test_scores(uuid,smallint) to authenticated;
