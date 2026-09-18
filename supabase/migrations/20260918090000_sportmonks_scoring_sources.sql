-- Reviewed identities and replayable source evidence, accessible only to the server.
create table public.sportmonks_fixture_sources (
 fixture_id bigint primary key references public.football_fixture_cache(fixture_id),
 sportmonks_id bigint not null unique,
 raw_data jsonb not null,
 player_map jsonb not null,
 captured_at timestamptz not null default now(),
 imported_at timestamptz,
 check(jsonb_typeof(player_map)='object'),
 check((raw_data->>'id')::bigint=sportmonks_id)
);
alter table public.sportmonks_fixture_sources enable row level security;
revoke all on public.sportmonks_fixture_sources from public,anon,authenticated;
grant select,insert,update on public.sportmonks_fixture_sources to service_role;

alter table public.football_fixture_player_stats add column second_yellow_cards smallint not null default 0 check(second_yellow_cards>=0);
create or replace function private.calculate_fixture_player_row()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_position text; v_final boolean; v_result jsonb;
begin
 select position::text into v_position from public.players where id=new.player_id;
 select lower(status) in ('final','ft','aet','pen') into v_final from public.football_fixture_cache where fixture_id=new.fixture_id;
 v_result:=private.calculate_fantasy_score(v_position,new.minutes,new.goals,new.assists,new.shots_on_target,
  new.completed_passes,new.tackles_won,new.penalty_goals,new.penalties_missed,new.penalties_conceded,
  new.saves,new.penalties_saved,new.goals_conceded,new.yellow_cards,new.second_yellow_cards,new.red_cards,
  new.own_goals,new.man_of_the_match,coalesce(v_final,false));
 new.fantasy_points:=(v_result->>'total')::numeric;
 new.score_ledger:=v_result->'entries';new.calculator_version:=v_result->>'version';return new;
end;$$;
