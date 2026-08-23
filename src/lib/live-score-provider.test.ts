import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CachedFixture, ProviderFixture } from "./live-score-domain";

const { apiFootball } = vi.hoisted(() => ({ apiFootball: vi.fn() }));
vi.mock("./api-football-server", () => ({ apiFootball }));

import { fetchProviderSnapshot } from "./live-score-provider";

const completedFixture: ProviderFixture = {
  fixture: { id: 1570344, date: "2026-08-23T15:00:00Z", status: { short: "FT" } },
  teams: { home: { id: 530 }, away: { id: 533 } },
  goals: { home: 2, away: 2 },
};

describe("provider snapshot fetching", () => {
  beforeEach(() => apiFootball.mockReset());

  it("recovers a dropped FT fixture and still requests its final player statistics", async () => {
    const candidates: CachedFixture[] = [{
      fixture_id: 1570344,
      status: "2H",
      kickoff: "2026-08-23T15:00:00Z",
    }];
    apiFootball
      .mockResolvedValueOnce({ response: [] })
      .mockResolvedValueOnce({ response: [completedFixture] })
      .mockResolvedValueOnce({ response: [] });

    const snapshot = await fetchProviderSnapshot(candidates);

    expect(apiFootball.mock.calls.map(([path]) => path)).toEqual([
      "fixtures?live=all",
      "fixtures?id=1570344",
      "fixtures/players?fixture=1570344",
    ]);
    expect(snapshot.recoveredFixtures).toEqual([completedFixture]);
    expect(snapshot.playerPages).toEqual([{ fixture: completedFixture, teams: [] }]);
    expect(snapshot.requestsUsed).toBe(3);
  });
});
