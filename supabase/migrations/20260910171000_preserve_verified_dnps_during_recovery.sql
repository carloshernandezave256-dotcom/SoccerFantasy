create or replace function private.preserve_verified_dnp_evidence()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  -- A historical week rebuild emits a generic zero row for players with no
  -- provider stat row. Do not let that erase explicit matchday-squad DNP proof.
  -- Real provider statistics are still allowed to replace the DNP if they arrive.
  if old.source in (
       'fotmob-verified-not-in-matchday-squad',
       'api-football-verified-not-in-matchday-squad'
     )
     and old.status = 'final'
     and not coalesce(old.stats_received, false)
     and old.minutes = 0
     and not coalesce(new.stats_received, false)
     and new.source = 'api-football-fixture-sum'
     and new.minutes = 0
  then
    new.status := old.status;
    new.source := old.source;
    new.source_updated_at := old.source_updated_at;
    new.calculator_version := old.calculator_version;
    new.fantasy_points := old.fantasy_points;
    new.score_ledger := old.score_ledger;
  end if;
  return new;
end;
$function$;

drop trigger if exists preserve_verified_dnp_evidence on public.league_player_scores;
create trigger preserve_verified_dnp_evidence
before update on public.league_player_scores
for each row execute function private.preserve_verified_dnp_evidence();
