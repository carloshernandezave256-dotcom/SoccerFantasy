alter table public.football_fixture_cache
  add column if not exists events_synced_at timestamptz;

alter table public.football_fixture_player_stats
  add column if not exists own_goals smallint not null default 0
  check (own_goals >= 0);

create or replace function private.calculate_fixture_player_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_position text;
  v_final boolean;
  v_result jsonb;
begin
  select player.position::text into v_position
  from public.players as player
  where player.id = new.player_id;

  select lower(fixture.status) in ('final','ft','aet','pen') into v_final
  from public.football_fixture_cache as fixture
  where fixture.fixture_id = new.fixture_id;

  v_result := private.calculate_fantasy_score(
    v_position,new.minutes,new.goals,new.assists,new.shots_on_target,
    new.completed_passes,new.tackles_won,new.penalty_goals,new.penalties_missed,
    new.penalties_conceded,new.saves,new.penalties_saved,new.goals_conceded,
    new.yellow_cards,0,new.red_cards,new.own_goals,new.man_of_the_match,
    coalesce(v_final,false)
  );
  new.fantasy_points := (v_result ->> 'total')::numeric;
  new.score_ledger := v_result -> 'entries';
  new.calculator_version := v_result ->> 'version';
  return new;
end;
$$;

update public.football_fixture_player_stats
set source_updated_at = source_updated_at;
