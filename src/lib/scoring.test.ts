import { describe, expect, it } from "vitest";
import { calculateScore } from "./scoring";

describe("custom scoring", () => {
  it("uses shots on target and MOTM without a big-chance deduction", () => {
    const result = calculateScore({ position: "MID", minutes: 90, shotsOnTarget: 3, manOfTheMatch: true });
    expect(result.total).toBe(6); // minutes 2 + SOT 3 + MOTM 1
  });

  it("awards position goals and the hat-trick target bonus", () => {
    expect(calculateScore({ position: "FWD", minutes: 90, goals: 3 }).total).toBe(12); // 2 + 9 + 1
    expect(calculateScore({ position: "MID", minutes: 90, goals: 3 }).total).toBe(17); // 2 + 12 + 3
  });

  it("uses complete threshold blocks", () => {
    const result = calculateScore({ position: "DEF", minutes: 59, completedPasses: 29, tacklesWon: 5 });
    expect(result.total).toBe(4); // minutes 1 + passes 2 + tackles 1
    expect(result.entries.find((entry) => entry.code === "passes")?.detail).toBe("29 completed passes · 1 FP for every 10");
    expect(result.entries.find((entry) => entry.code === "tackles")?.detail).toBe("5 tackles won · 1 FP for every 3");
  });

  it("awards and removes defensive clean-sheet points correctly", () => {
    expect(calculateScore({ position: "DEF", minutes: 90, goalsConceded: 0 }).total).toBe(5);
    expect(calculateScore({ position: "DEF", minutes: 90, goalsConceded: 3 }).total).toBe(-1);
  });

  it("keeps an itemized ledger that reconciles to the total", () => {
    const result = calculateScore({ position: "GK", minutes: 90, saves: 7, penaltiesSaved: 1, yellowCards: 1 });
    expect(result.entries.reduce((sum, item) => sum + item.points, 0)).toBe(result.total);
    expect(result.total).toBe(8); // minutes 2 + saves 2 + pen save 2 + clean sheet 3 - yellow 1
  });

  it("awards one for Man of the Match and four more for a correct captain prediction", () => {
    const captain = calculateScore({ position: "MID", minutes: 90, manOfTheMatch: true, captain: true });
    const regular = calculateScore({ position: "MID", minutes: 90, manOfTheMatch: true });
    expect(regular.entries.find((entry) => entry.code === "motm")?.points).toBe(1);
    expect(captain.total).toBe(regular.total + 4);
    expect(captain.entries.some((entry) => entry.code === "captain-motm")).toBe(true);
  });
});
