import { describe, expect, it } from "vitest";
import { calculateScore } from "./scoring";
import { simulatedTeams } from "./simulated-gameweek";

describe("simulated gameweek", () => {
  it("reconciles every player ledger into the displayed team totals", () => {
    const totals = simulatedTeams.map((team) =>
      team.players.reduce((teamTotal, player) => {
        const score = calculateScore(player.stats);
        expect(score.entries.reduce((sum, entry) => sum + entry.points, 0)).toBe(score.total);
        return teamTotal + score.total;
      }, 0)
    );

    expect(totals).toEqual([113, 105]);
  });
});
