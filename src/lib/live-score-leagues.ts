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
): Promise<LeagueRefreshSummary> {
  const affectedGameweeks = await store.affectedLeagueGameweeks(fixtureIds);
  let leagueRowsUpdated = 0;
  let leagueGameweeksUpdated = 0;

  for (const { leagueId, gameweek } of affectedGameweeks) {
    const { league, window } = await store.leagueContext(leagueId, gameweek);
    if (!league || !window || new Date(window.roster_lock_at) > now) continue;

    const calendarFixtures = await store.calendarFixtures(
      leagueId,
      league.calendar_competition,
      window.gameweek,
    );
    if (!calendarFixtures.length || new Date(calendarFixtures[0].kickoff) > now) continue;

    const weekFixtures = await store.weekFixtures(
      leagueId,
      league.player_pool,
      gameweek,
    );
    const fixtureIdsForWeek = weekFixtures.map((fixture) => fixture.fixture_id);
    if (!fixtureIdsForWeek.length) continue;

    const [fixtureStats, lineupPlayerIds, poolPlayerIds] = await Promise.all([
      store.fixtureStats(fixtureIdsForWeek),
      store.lineupPlayerIds(leagueId),
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
      gameweek,
      playerIds,
      fixtureStats,
      weekFixtures,
      updatedAt: now.toISOString(),
    });
    if (!rows.length) continue;

    await store.upsertLeagueScores(rows);
    await store.refreshMatchupScores(leagueId, gameweek);
    await store.settleFinalGameweek(leagueId, gameweek);
    leagueRowsUpdated += rows.length;
    leagueGameweeksUpdated += 1;
  }

  return { leagueRowsUpdated, leagueGameweeksUpdated };
}
