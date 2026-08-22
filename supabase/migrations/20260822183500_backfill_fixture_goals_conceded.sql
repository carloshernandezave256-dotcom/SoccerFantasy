-- API-Football's per-player goals.conceded value is often empty/zero for
-- outfield players. Defensive fantasy scoring must use the team's fixture
-- result instead.
update public.football_fixture_player_stats s
set goals_conceded=case
    when lower(p.club)=lower(f.home_team) then coalesce(f.away_score,0)
    when lower(p.club)=lower(f.away_team) then coalesce(f.home_score,0)
    else s.goals_conceded
  end,
  source_updated_at=greatest(s.source_updated_at,now())
from public.players p,public.football_fixture_cache f
where p.id=s.player_id and f.fixture_id=s.fixture_id
  and lower(f.status) in ('final','ft','aet','pen')
  and (lower(p.club)=lower(f.home_team) or lower(p.club)=lower(f.away_team));
