import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CachedFixture, ProviderFixture } from "./live-score-domain";

const { apiFootball } = vi.hoisted(() => ({ apiFootball: vi.fn() }));
vi.mock("./api-football-server", () => ({ apiFootball }));

import { fetchProviderOwnGoals, fetchProviderSnapshot } from "./live-score-provider";

const completedFixture: ProviderFixture = {
  fixture: { id: 1570344, date: "2026-08-23T15:00:00Z", status: { short: "FT" } },
  league: { id: 140, name: "La Liga" },
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
      events_synced_at: null,
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

  it("counts own-goal events by fixture and player", async () => {
    apiFootball.mockResolvedValueOnce({ response: [
      { player: { id: 1622, name: "G. Donnarumma" }, type: "Goal", detail: "Own Goal" },
      { player: { id: 1622, name: "G. Donnarumma" }, type: "Card", detail: "Yellow Card" },
    ] });

    const snapshot = await fetchProviderOwnGoals([1557381]);

    expect(apiFootball).toHaveBeenCalledWith("fixtures/events?fixture=1557381");
    expect(snapshot.byFixtureAndApiPlayer.get(1557381)?.get(1622)).toBe(1);
    expect(snapshot.requestsUsed).toBe(1);
  });
});
