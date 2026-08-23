import { apiFootball } from "./api-football-server";
import {
  partitionProviderFixtures,
  type CachedFixture,
  type ProviderFixture,
  type ProviderPlayerPage,
  type ProviderTeamPlayers,
} from "./live-score-domain";

type FixturePage = { response: ProviderFixture[] };
type PlayerPage = { response: ProviderTeamPlayers[] };

export type ProviderSnapshot = {
  fixtures: ProviderFixture[];
  liveFixtures: ProviderFixture[];
  recoveredFixtures: ProviderFixture[];
  playerPages: ProviderPlayerPage[];
  requestsUsed: number;
};

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
