import { describe, expect, it } from "vitest";
import { selectManOfTheMatchId, type RatedMatchPlayer } from "./match-awards";

const player = (overrides: Partial<RatedMatchPlayer>): RatedMatchPlayer => ({
  playerId: 1,
  rating: 7,
  minutes: 90,
  goals: 0,
  assists: 0,
  shotsOnTarget: 0,
  ...overrides,
});

describe("automatic Man of the Match", () => {
  it("selects the highest API-rated player", () => {
    expect(selectManOfTheMatchId([
      player({ playerId: 10, rating: 7.4 }),
      player({ playerId: 20, rating: 8.2 }),
    ])).toBe(20);
  });

  it("uses deterministic tie-breakers", () => {
    expect(selectManOfTheMatchId([
      player({ playerId: 10, rating: 8, goals: 1 }),
      player({ playerId: 20, rating: 8, goals: 2 }),
    ])).toBe(20);
  });

  it("does not award the match when ratings are unavailable", () => {
    expect(selectManOfTheMatchId([player({ rating: 0 })])).toBeNull();
  });
});
