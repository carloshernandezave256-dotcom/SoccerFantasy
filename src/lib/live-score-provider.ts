import { apiFootball } from "./api-football-server";
import {
  partitionProviderFixtures,
  type CachedFixture,
  type ProviderFixture,
  type ProviderFixtureEvent,
  type ProviderPlayerPage,
  type ProviderTeamPlayers,
} from "./live-score-domain";

type FixturePage = { response: ProviderFixture[] };
type PlayerPage = { response: ProviderTeamPlayers[] };
type EventPage = { response: ProviderFixtureEvent[] };

export type ProviderSnapshot = {
  fixtures: ProviderFixture[];
  liveFixtures: ProviderFixture[];
  recoveredFixtures: ProviderFixture[];
  playerPages: ProviderPlayerPage[];
  requestsUsed: number;
};

export type ProviderOwnGoalSnapshot = {
  byFixtureAndApiPlayer: Map<number, Map<number, number>>;
  fixtureIdsSynced: number[];
  requestsUsed: number;
};

export async function fetchProviderOwnGoals(fixtureIds: number[]): Promise<ProviderOwnGoalSnapshot> {
  const pages = await Promise.all(
    fixtureIds.map(async (fixtureId) => ({
      fixtureId,
      body: await apiFootball<EventPage>(`fixtures/events?fixture=${fixtureId}`),
    })),
  );
  const byFixtureAndApiPlayer = new Map<number, Map<number, number>>();
  for (const { fixtureId, body } of pages) {
    const ownGoals = new Map<number, number>();
    for (const event of body.response) {
      const apiPlayerId = event.player.id;
      if (apiPlayerId && event.type.toLowerCase() === "goal" && event.detail.toLowerCase() === "own goal") {
        ownGoals.set(apiPlayerId, (ownGoals.get(apiPlayerId) ?? 0) + 1);
      }
    }
    byFixtureAndApiPlayer.set(fixtureId, ownGoals);
  }
  return {
    byFixtureAndApiPlayer,
    fixtureIdsSynced: pages.map((page) => page.fixtureId),
    requestsUsed: pages.length,
  };
}

export async function fetchProviderSnapshot(candidates: CachedFixture[]): Promise<ProviderSnapshot> {
  const livePage = await apiFootball<FixturePage>("fixtures?live=all");
  const { liveFixtures, droppedCandidates } = partitionProviderFixtures(candidates, livePage.response);

  const recoveredPages = await Promise.all(
    droppedCandidates.map(async (candidate) => {
      const body = await apiFootball<FixturePage>(`fixtures?id=${candidate.fixture_id}`);
      return body.response[0] ?? null;
    }),
  );
  const recoveredFixtures = recoveredPages.filter(
    (fixture): fixture is ProviderFixture => fixture !== null,
  );
  const fixtures = [...liveFixtures, ...recoveredFixtures];

  // Always use the dedicated player-stat endpoint. Some competitions return
  // player shells from the fixture endpoint with empty statistics arrays.
  const playerPages = await Promise.all(
    fixtures.map(async (fixture) => {
      const body = await apiFootball<PlayerPage>(`fixtures/players?fixture=${fixture.fixture.id}`);
      return { fixture, teams: body.response };
    }),
  );

  return {
    fixtures,
    liveFixtures,
    recoveredFixtures,
    playerPages,
    requestsUsed: 1 + droppedCandidates.length + fixtures.length,
  };
}
