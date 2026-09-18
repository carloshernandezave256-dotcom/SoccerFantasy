-- Focused settlement harness. Reuses real snapshot and auto-substitution SQL.
-- Matchup refresh, archival capture and next-week scheduling are boundary doubles;
-- their existing implementations are not being changed or certified by this test.
create role service_role;
create function auth.jwt() returns jsonb language sql as $$select jsonb_build_object('role',current_setting('request.jwt.claim.role',true))$$;
alter table public.leagues add column calendar_competition text,add column player_pool text;
create table public.league_headline_fixtures(league_id uuid,fixture_id bigint,competition text,gameweek smallint,kickoff timestamptz,status text,primary key(league_id,fixture_id));
create table public.finalized_gameweek_locks(league_id uuid,gameweek smallint,primary key(league_id,gameweek));
create table public.football_fixture_player_stats(fixture_id bigint,player_id bigint,source_updated_at timestamptz,primary key(fixture_id,player_id));
create table public.football_fixture_cache(fixture_id bigint,status text,kickoff timestamptz,events_synced_at timestamptz);
alter table public.lineup_players add column is_starter boolean,add column is_captain boolean,add column pitch_order smallint,add column bench_order smallint,add column updated_at timestamptz;
create table public.lineup_gameweek_players(league_id uuid,gameweek smallint,user_id uuid,player_id bigint,is_starter boolean,is_star_pick boolean,pitch_order smallint,captured_at timestamptz,primary key(league_id,gameweek,user_id,player_id));
create table public.lineup_gameweek_substitutions(league_id uuid,gameweek smallint,user_id uuid,outgoing_player_id bigint,incoming_player_id bigint,position text,outgoing_pitch_order smallint,incoming_bench_order smallint,incoming_points numeric,carried_to_lineup_at timestamptz,unique(league_id,gameweek,user_id,outgoing_player_id));
create table public.pack_cards(league_id uuid,user_id uuid,player_id bigint,active_slot int);
create table public.league_player_scores(league_id uuid,gameweek smallint,player_id bigint,status text,source text,source_updated_at timestamptz,updated_at timestamptz,score_ledger jsonb,calculator_version text,stats_received boolean,man_of_the_match boolean,rating numeric,minutes numeric,goals numeric,assists numeric,shots_on_target numeric,big_chances_missed numeric,completed_passes numeric,tackles_won numeric,penalty_goals numeric,penalties_missed numeric,penalties_conceded numeric,saves numeric,penalties_saved numeric,goals_conceded numeric,yellow_cards numeric,second_yellow_cards numeric,red_cards numeric,own_goals numeric,fantasy_points numeric,primary key(league_id,gameweek,player_id));
create function public.refresh_league_matchup_scores(uuid,smallint) returns integer language sql as $$select 0$$;
create function private.open_next_gameweek(uuid,smallint) returns void language plpgsql as $$begin return;end$$;
create function private.lock_finalized_gameweek(uuid,smallint) returns void language sql as $$insert into public.finalized_gameweek_locks values($1,$2) on conflict do nothing$$;
CREATE OR REPLACE FUNCTION private.apply_gameweek_auto_substitutions(p_league_id uuid, p_gameweek smallint)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.gameweek_scoring_fixtures_final(p_league_id, p_gameweek) then
    return 0;
  end if;

  return private.apply_gameweek_auto_substitution_settlement(
    p_league_id,
    p_gameweek
  );
end;
$function$;
