-- Bulk score publication already performs settlement after the complete batch.
-- Keep legacy row-trigger behavior for every other write path.
create or replace function private.apply_final_score_auto_substitutions()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if pg_catalog.current_setting('app.scoring_publish_batch',true)=new.league_id::text||':'||new.gameweek::text then return new;end if;
 if new.status='final' then perform private.apply_gameweek_auto_substitutions(new.league_id,new.gameweek::smallint);end if;
 return new;
end;$$;

create or replace function public.publish_gameweek_scores(p_league_id uuid,p_gameweek smallint,p_rows jsonb,p_evidence jsonb)
returns integer language plpgsql security definer set search_path='' as $$
declare v_count integer;v_ready boolean;v_prior_batch text;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Service role required';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_league_id::text||':'||p_gameweek::text,0));
 if exists(select 1 from public.finalized_gameweek_locks where league_id=p_league_id and gameweek=p_gameweek) then return 0;end if;
 perform private.freeze_gameweek_fixtures(p_league_id,p_gameweek);
 if not exists(select 1 from private.gameweek_fixture_sets where league_id=p_league_id and gameweek=p_gameweek) then raise exception 'Week fixtures are not frozen';end if;
 perform 1 from private.fixture_stat_evidence e join private.gameweek_fixture_members m using(fixture_id)
   where m.league_id=p_league_id and m.gameweek=p_gameweek order by e.fixture_id for share of e;
 if exists(
   (select f.fixture_id,f.status,e.observed_at from private.gameweek_scoring_fixtures(p_league_id,p_gameweek) f
     left join private.fixture_stat_evidence e using(fixture_id)
    except select x.fixture_id,x.status,x.evidence_version from jsonb_to_recordset(p_evidence) x(fixture_id bigint,status text,evidence_version timestamptz))
   union all
   (select x.fixture_id,x.status,x.evidence_version from jsonb_to_recordset(p_evidence) x(fixture_id bigint,status text,evidence_version timestamptz)
    except select f.fixture_id,f.status,e.observed_at from private.gameweek_scoring_fixtures(p_league_id,p_gameweek) f left join private.fixture_stat_evidence e using(fixture_id))
 ) then raise exception 'Fixture evidence changed; retry synchronization';end if;
 if exists(select 1 from jsonb_to_recordset(p_rows) r(league_id uuid,gameweek smallint)
   where r.league_id is distinct from p_league_id or r.gameweek is distinct from p_gameweek) then raise exception 'Score row belongs to another week';end if;
 perform private.snapshot_gameweek_lineups(p_league_id,p_gameweek);
 if exists(select 1 from public.lineup_gameweek_players s where s.league_id=p_league_id and s.gameweek=p_gameweek
   and not exists(select 1 from jsonb_to_recordset(p_rows) r(player_id bigint) where r.player_id=s.player_id)) then raise exception 'Publication omits a locked player';end if;
 v_ready:=private.gameweek_scoring_fixtures_final(p_league_id,p_gameweek);
 -- Server completeness is authoritative, regardless of caller-supplied flags.
 p_rows:=(select coalesce(jsonb_agg(value||jsonb_build_object('data_complete',v_ready,'status',case when v_ready then 'final' else 'live' end)),'[]'::jsonb) from jsonb_array_elements(p_rows));
 v_prior_batch:=pg_catalog.current_setting('app.scoring_publish_batch',true);
 perform pg_catalog.set_config('app.scoring_publish_batch',p_league_id::text||':'||p_gameweek::text,true);
 insert into public.league_player_scores(league_id,gameweek,player_id,rating,minutes,goals,assists,shots_on_target,big_chances_missed,completed_passes,tackles_won,penalty_goals,penalties_missed,penalties_conceded,saves,penalties_saved,goals_conceded,yellow_cards,second_yellow_cards,red_cards,own_goals,man_of_the_match,stats_received,data_complete,status,source,source_updated_at,updated_at,fantasy_points,score_ledger,calculator_version)
 select league_id,gameweek,player_id,rating,minutes,goals,assists,shots_on_target,big_chances_missed,completed_passes,tackles_won,penalty_goals,penalties_missed,penalties_conceded,saves,penalties_saved,goals_conceded,yellow_cards,second_yellow_cards,red_cards,own_goals,man_of_the_match,stats_received,data_complete,status,source,source_updated_at,updated_at,fantasy_points,score_ledger,calculator_version from jsonb_populate_recordset(null::public.league_player_scores,p_rows)
 on conflict(league_id,gameweek,player_id) do update set rating=excluded.rating,minutes=excluded.minutes,goals=excluded.goals,assists=excluded.assists,shots_on_target=excluded.shots_on_target,big_chances_missed=excluded.big_chances_missed,completed_passes=excluded.completed_passes,tackles_won=excluded.tackles_won,penalty_goals=excluded.penalty_goals,penalties_missed=excluded.penalties_missed,penalties_conceded=excluded.penalties_conceded,saves=excluded.saves,penalties_saved=excluded.penalties_saved,goals_conceded=excluded.goals_conceded,yellow_cards=excluded.yellow_cards,second_yellow_cards=excluded.second_yellow_cards,red_cards=excluded.red_cards,own_goals=excluded.own_goals,man_of_the_match=excluded.man_of_the_match,stats_received=excluded.stats_received,data_complete=excluded.data_complete,status=excluded.status,source=excluded.source,source_updated_at=excluded.source_updated_at,updated_at=excluded.updated_at,fantasy_points=excluded.fantasy_points,score_ledger=excluded.score_ledger,calculator_version=excluded.calculator_version;
 get diagnostics v_count=row_count;
 perform pg_catalog.set_config('app.scoring_publish_batch',coalesce(v_prior_batch,''),true);
 perform public.refresh_league_matchup_scores(p_league_id,p_gameweek);
 perform public.settle_final_gameweek(p_league_id,p_gameweek);
 return v_count;
end;$$;
revoke all on function public.publish_gameweek_scores(uuid,smallint,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.publish_gameweek_scores(uuid,smallint,jsonb,jsonb) to service_role;

