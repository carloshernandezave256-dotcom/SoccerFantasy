import { describe, expect, it } from "vitest";
import { calculateScore, isTerminalMatchStatus, resolvePlayerScoreStatus } from "./scoring";

describe("custom scoring", () => {
  it("awards one point for each complete group of three shots on target", () => {
    const result = calculateScore({ position: "MID", minutes: 90, shotsOnTarget: 3, manOfTheMatch: true });
    expect(result.total).toBe(3); // minutes 2 + one complete SOT group
    expect(calculateScore({ position: "MID", minutes: 90, shotsOnTarget: 2 }).total).toBe(2);
    expect(calculateScore({ position: "MID", minutes: 90, shotsOnTarget: 6 }).total).toBe(4);
  });

  it("awards position goals and the hat-trick target bonus", () => {
    expect(calculateScore({ position: "FWD", minutes: 90, goals: 3 }).total).toBe(12); // 2 + 9 + 1
    expect(calculateScore({ position: "MID", minutes: 90, goals: 3 }).total).toBe(17); // 2 + 12 + 3
  });

  it.each([
    ["FWD", 10],
    ["MID", 15],
    ["DEF", 20],
    ["GK", 30],
  ] as const)("scores a three-penalty %s hat-trick at the published total", (position, total) => {
    const result = calculateScore({ position, minutes: 0, goals: 3, penaltyGoals: 3 });
    expect(result.total).toBe(total);
    expect(result.entries.find((entry) => entry.code === "penalty-goals")?.points).toBe(6);
    expect(result.entries.find((entry) => entry.code === "goals")).toBeUndefined();
  });

  it("uses complete threshold blocks", () => {
    const result = calculateScore({ position: "DEF", minutes: 59, completedPasses: 29, tacklesWon: 5 });
    expect(result.total).toBe(4); // minutes 1 + passes 2 + tackles 1
    expect(result.entries.find((entry) => entry.code === "passes")?.detail).toBe("29 completed passes · 1 FP for every 10");
    expect(result.entries.find((entry) => entry.code === "tackles")?.detail).toBe("5 tackles won · 1 FP for every 3");
  });

  it.each(["GK", "DEF", "MID", "FWD"] as const)("awards completed-pass points to %s players", (position) => {
    const result = calculateScore({ position, minutes: 1, completedPasses: 29 });
    expect(result.entries.find((entry) => entry.code === "passes")?.points).toBe(2);
  });

  it("awards and removes defensive clean-sheet points correctly", () => {
    expect(calculateScore({ position: "DEF", minutes: 90, goalsConceded: 0 }).total).toBe(5);
    expect(calculateScore({ position: "DEF", minutes: 90, goalsConceded: 3 }).total).toBe(-1);
  });

  it("awards clean sheets for any appearance by position", () => {
    expect(calculateScore({ position: "GK", minutes: 1, goalsConceded: 0 }).total).toBe(4);
    expect(calculateScore({ position: "DEF", minutes: 1, goalsConceded: 0 }).total).toBe(4);
    expect(calculateScore({ position: "MID", minutes: 1, goalsConceded: 0 }).total).toBe(2);
    expect(calculateScore({ position: "FWD", minutes: 1, goalsConceded: 0 }).total).toBe(1);
  });

  it("waits until full time to award a clean sheet", () => {
    const result = calculateScore({ position: "DEF", minutes: 75, goalsConceded: 0, status: "live" });
    expect(result.total).toBe(2);
    expect(result.entries.find((entry) => entry.code === "clean-sheet")).toBeUndefined();
  });

  it("keeps an itemized ledger that reconciles to the total", () => {
    const result = calculateScore({ position: "GK", minutes: 90, saves: 7, penaltiesSaved: 1, yellowCards: 1 });
    expect(result.entries.reduce((sum, item) => sum + item.points, 0)).toBe(result.total);
    expect(result.total).toBe(8); // minutes 2 + saves 2 + pen save 2 + clean sheet 3 - yellow 1
  });

  it("gives the captain exactly 50 percent additional fantasy points", () => {
    const winner = calculateScore({ position: "MID", minutes: 90, goals: 1, captain: true });
    expect(winner.total).toBe(9); // base 6 multiplied by 1.5
    expect(winner.entries.find((entry) => entry.code === "captain-bonus")?.points).toBe(3);
  });

  it("also multiplies a negative captain score by 1.5", () => {
    const captain = calculateScore({ position: "FWD", minutes: 1, redCards: 1, captain: true });
    expect(captain.total).toBe(-3); // base -2 multiplied by 1.5
    expect(captain.entries.find((entry) => entry.code === "captain-bonus")?.points).toBe(-1);
  });
});

describe("resolvePlayerScoreStatus", () => {
  it("recognizes both app and API-Football completed statuses", () => {
    expect(isTerminalMatchStatus("final")).toBe(true);
    expect(isTerminalMatchStatus("FT")).toBe(true);
    expect(isTerminalMatchStatus("2H")).toBe(false);
  });

  it("finalizes a player when their own fixture ends before the gameweek", () => {
    expect(resolvePlayerScoreStatus(["FT"], false)).toBe("final");
  });

  it("keeps a player live while their own fixture is live", () => {
    expect(resolvePlayerScoreStatus(["2H"], false)).toBe("live");
  });

  it("uses gameweek status when a player has no fixture stats", () => {
    expect(resolvePlayerScoreStatus([], false)).toBe("live");
    expect(resolvePlayerScoreStatus([], true)).toBe("final");
  });
});
