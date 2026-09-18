import { buildLeaguePlayerScoreRows } from "./live-score-domain";
import { LiveScoreStore } from "./live-score-store";

export type LeagueRefreshSummary = {
  leagueRowsUpdated: number;
  leagueGameweeksUpdated: number;
};

export async function refreshAffectedLeagueScores(
  store: LiveScoreStore,
  fixtureIds: number[],
  now: Date,
  excludedLeagueIds: string[] = [],
): Promise<LeagueRefreshSummary> {
  const leagueIds = fixtureIds.length ? await store.affectedLeagueIds(fixtureIds) : excludedLeagueIds;
  let leagueRowsUpdated = 0;
  let leagueGameweeksUpdated = 0;

  for (const leagueId of leagueIds) {
    const { league, window } = await store.leagueContext(leagueId);
    if (!league || !window || new Date(window.roster_lock_at) > now) continue;

    if(await store.gameweekFinalized(leagueId,window.gameweek))continue;
    const weekFixtures=await store.scoringWeekFixtures(leagueId,window.gameweek);
    // A catch-up fixture may exist in league history without belonging to this
    // fantasy week. Such an update must not publish or settle any matchup.
    const allExcluded=weekFixtures.length>0&&weekFixtures.every(f=>f.status==='EXCLUDED');
    if(!weekFixtures.some(f=>f.status!=='EXCLUDED'&&fixtureIds.includes(f.fixture_id))
      && !(excludedLeagueIds.includes(leagueId)&&allExcluded))continue;
    const fixtureIdsForWeek=weekFixtures.filter(f=>f.status!=='EXCLUDED').map(f=>f.fixture_id);

    const [fixtureStats, lineupPlayerIds, poolPlayerIds] = await Promise.all([
      fixtureIdsForWeek.length?store.fixtureStats(fixtureIdsForWeek):Promise.resolve([]),
      store.lineupPlayerIds(leagueId,window.gameweek),
      store.poolPlayerIds(league.player_pool),
    ]);
    const playerIds = [
      ...new Set([
        ...poolPlayerIds,
        ...lineupPlayerIds,
        ...fixtureStats.map((stat) => stat.player_id),
      ]),
    ];
    const rows = buildLeaguePlayerScoreRows({
      leagueId,
      gameweek: window.gameweek,
      playerIds,
      fixtureStats,
      weekFixtures,
      updatedAt: now.toISOString(),
    });
    if (!rows.length) continue;

    const published=await store.publishLeagueScores(leagueId,window.gameweek,rows,weekFixtures);
    leagueRowsUpdated+=published;
    if(published>0)leagueGameweeksUpdated+=1;
  }

  return { leagueRowsUpdated, leagueGameweeksUpdated };
}
