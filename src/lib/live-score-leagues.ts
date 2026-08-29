import { buildLeaguePlayerScoreRows } from "./live-score-domain";
import { fantasyWeekWindow,fixturesForFantasyWeek } from "./fantasy-week-window";
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

    const scoringWindow=fantasyWeekWindow(calendarFixtures);
    if(!scoringWindow)continue;
    const windowFixtures = await store.weekFixtures(
      leagueId,
      league.player_pool,
      scoringWindow.startsAt,
      scoringWindow.endsAt,
    );
    const weekFixtures=fixturesForFantasyWeek(
      windowFixtures.map(fixture=>({
        ...fixture,
        officialRound:fixture.gameweek,
      })),
      scoringWindow,
      {[league.calendar_competition]:window.gameweek},
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
