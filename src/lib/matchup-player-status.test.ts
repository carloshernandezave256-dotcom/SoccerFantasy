import { describe, expect, it } from "vitest";
import { fixtureForClub, resolvePlayerDataStatus } from "./matchup-player-status";

describe("matchup player data status", () => {
  it("matches club names without punctuation, spaces, or accents", () => {
    const fixture = fixtureForClub([
      { status: "FT", kickoff: "2026-08-23T18:00:00Z", home_team: "Paris Saint-Germain", away_team: "Lens" },
    ], "Paris Saint Germain");
    expect(fixture?.status).toBe("FT");
  });

  it("shows upcoming before the player's club fixture starts", () => {
    expect(resolvePlayerDataStatus({ fixtureStatus: "NS", scoreStatus: "live", minutes: 0, statsReceived: false })).toBe("upcoming");
  });

  it("shows live while the player's club fixture is in progress", () => {
    expect(resolvePlayerDataStatus({ fixtureStatus: "2H", scoreStatus: "live", minutes: 52, statsReceived: true })).toBe("live");
  });

  it("only calls a completed zero did-not-play when provider stats were received", () => {
    expect(resolvePlayerDataStatus({ fixtureStatus: "FT", scoreStatus: "final", minutes: 0, statsReceived: true })).toBe("did_not_play");
    expect(resolvePlayerDataStatus({ fixtureStatus: "FT", scoreStatus: "final", minutes: 0, statsReceived: false })).toBe("stats_pending");
  });

  it("shows FT after final player statistics arrive", () => {
    expect(resolvePlayerDataStatus({ fixtureStatus: "FT", scoreStatus: "final", minutes: 90, statsReceived: true })).toBe("final");
  });
});
