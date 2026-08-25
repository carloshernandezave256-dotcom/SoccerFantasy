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
  const leagueIds = await store.affectedLeagueIds(fixtureIds);
  let leagueRowsUpdated = 0;
  let leagueGameweeksUpdated = 0;

  for (const leagueId of leagueIds) {
    const { league, window } = await store.leagueContext(leagueId);
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
      calendarFixtures[0].kickoff,
      calendarFixtures[calendarFixtures.length - 1].kickoff,
    );
    const fixtureIdsForWeek = weekFixtures.map((fixture) => fixture.fixture_id);
    if (!fixtureIdsForWeek.length) continue;

    const [fixtureStats, lineupPlayerIds] = await Promise.all([
      store.fixtureStats(fixtureIdsForWeek),
      store.lineupPlayerIds(leagueId),
    ]);
    const playerIds = [
      ...new Set([
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

    await store.upsertLeagueScores(rows);
    await store.refreshMatchupScores(leagueId, window.gameweek);
    await store.settleFinalGameweek(leagueId, window.gameweek);
    leagueRowsUpdated += rows.length;
    leagueGameweeksUpdated += 1;
  }

  return { leagueRowsUpdated, leagueGameweeksUpdated };
}
