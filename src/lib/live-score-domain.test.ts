import { describe, expect, it } from "vitest";
import {
  buildLeaguePlayerScoreRows,
  normalizeProviderPlayerPages,
  partitionProviderFixtures,
  reconcileFixtureStatus,
  type ProviderFixture,
  type ProviderPlayerPage,
} from "./live-score-domain";

const fixture = (status: string): ProviderFixture => ({
  fixture: { id: 1570344, date: "2026-08-23T15:00:00Z", status: { short: status } },
  teams: { home: { id: 530 }, away: { id: 533 } },
  goals: { home: 2, away: 2 },
});

function playerPage(minutes: number): ProviderPlayerPage {
  return {
    fixture: fixture("FT"),
    teams: [{
      team: { id: 530, name: "Atletico Madrid" },
      players: [{
        player: { id: 753, name: "Marcos Llorente" },
        statistics: [{
          games: { minutes, rating: "6.90", position: "M" },
          shots: { on: 0 },
          goals: { total: 0, assists: 0, conceded: 2, saves: 0 },
          passes: { total: 21, accuracy: "95%" },
          tackles: { total: 1 },
          cards: { yellow: 0, red: 0 },
          penalty: { scored: 0, missed: 0, saved: 0, commited: 0 },
        }],
      }],
    }],
  };
}

describe("live score fixture status reconciliation", () => {
  it("requires two terminal provider observations before accepting FT", () => {
    expect(reconcileFixtureStatus("FT", "2H", "2H")).toBe("2H");
    expect(reconcileFixtureStatus("FT", "2H", "FT")).toBe("FT");
  });

  it("accepts live progress immediately", () => {
    expect(reconcileFixtureStatus("2H", "HT", "HT")).toBe("2H");
  });

  it("plans an individual lookup whenever a candidate disappears from live fixtures", () => {
    const candidates = [
      { fixture_id: 1570344, status: "FT", kickoff: "2026-08-23T15:00:00Z" },
      { fixture_id: 1570348, status: "2H", kickoff: "2026-08-23T15:30:00Z", events_synced_at: null },
    ];
    const result = partitionProviderFixtures(candidates, [
      { ...fixture("2H"), fixture: { ...fixture("2H").fixture, id: 1570348 } },
    ]);
    expect(result.liveFixtures.map((item) => item.fixture.id)).toEqual([1570348]);
    expect(result.droppedCandidates.map((item) => item.fixture_id)).toEqual([1570344]);
  });
});

describe("live score player normalization", () => {
  it("replays the Llorente payload and replaces minutes on a later provider response", () => {
    const mapping = new Map([[753, 1272]]);
    const initial = normalizeProviderPlayerPages([playerPage(24)], mapping, "2026-08-23T17:06:00Z");
    const corrected = normalizeProviderPlayerPages([playerPage(31)], mapping, "2026-08-23T17:14:00Z");

    expect(initial.rows[0]).toMatchObject({ player_id: 1272, minutes: 24, completed_passes: 20 });
    expect(corrected.rows[0]).toMatchObject({ player_id: 1272, minutes: 31, source_updated_at: "2026-08-23T17:14:00Z" });
    expect(corrected.observations[0]).toMatchObject({ provider_player_rows: 1, mapped_player_rows: 1 });
  });

  it("records unmapped provider players instead of silently dropping evidence", () => {
    const result = normalizeProviderPlayerPages([playerPage(24)], new Map(), "2026-08-23T17:06:00Z");
    expect(result.rows).toHaveLength(0);
    expect(result.observations[0].unmapped_players[0]).toMatchObject({ api_football_id: 753, minutes: 24 });
  });

  it("adds own goals from the fixture event ledger", () => {
    const ownGoals = new Map([[1570344, new Map([[753, 1]])]]);
    const result = normalizeProviderPlayerPages(
      [playerPage(90)],
      new Map([[753, 1272]]),
      "2026-08-23T17:14:00Z",
      ownGoals,
    );
    expect(result.rows[0]).toMatchObject({ player_id: 1272, own_goals: 1 });
  });
});

describe("league score aggregation", () => {
  it("combines all fixture stats and finalizes only the player's own completed fixtures", () => {
    const rows = buildLeaguePlayerScoreRows({
      leagueId: "league-1",
      gameweek: 2,
      playerIds: [1272, 9999],
      fixtureStats: [
        { fixture_id: 1570344, player_id: 1272, minutes: 24, completed_passes: 20, rating: 6.9, own_goals: 1 },
      ],
      weekFixtures: [
        { fixture_id: 1570344, status: "FT", kickoff: "2026-08-23T15:00:00Z", competition: "Premier League", gameweek: 2 },
        { fixture_id: 1570348, status: "2H", kickoff: "2026-08-23T15:30:00Z", competition: "Premier League", gameweek: 2 },
      ],
      updatedAt: "2026-08-23T17:14:00Z",
    });
    expect(rows[0]).toMatchObject({ player_id: 1272, minutes: 24, completed_passes: 20, own_goals: 1, status: "final" });
    expect(rows[1]).toMatchObject({ player_id: 9999, minutes: 0, status: "live" });
  });
});
