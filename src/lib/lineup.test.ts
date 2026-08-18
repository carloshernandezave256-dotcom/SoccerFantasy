import { describe, expect, it } from "vitest";
import { formationIsValid, lineupIsReady, reorderWithinPosition, type LeagueFormat, type LineupPlayer } from "./lineup";

const formats: LeagueFormat[] = ["draft", "auction", "pack"];

function rosterFor(defenders: number, midfielders: number, forwards: number) {
  let id = 1;
  const add = (position: string, count: number) =>
    Array.from({ length: count }, () => ({ id: id++, position }));
  return [...add("GK", 1), ...add("DEF", defenders), ...add("MID", midfielders), ...add("FWD", forwards)];
}

describe.each(formats)("shared %s lineup rules", (format) => {
  it.each([
    ["4-3-3", 4, 3, 3],
    ["3-3-4", 3, 3, 4],
    ["4-2-4", 4, 2, 4],
  ])("accepts %s", (_name, defenders, midfielders, forwards) => {
    const roster = rosterFor(defenders as number, midfielders as number, forwards as number);
    expect(formationIsValid(roster, new Set(roster.map((player) => player.id)))).toBe(true);
  });

  it("rejects 3-2-5", () => {
    const roster = rosterFor(3, 2, 5);
    expect(formationIsValid(roster, new Set(roster.map((player) => player.id)))).toBe(false);
  });

  it("requires the saved captain to be in the valid starting XI", () => {
    const roster = rosterFor(4, 3, 3);
    const starters = new Set(roster.map((player) => player.id));
    expect(lineupIsReady(roster, starters, roster[1].id)).toBe(true);
    expect(lineupIsReady(roster, starters, null)).toBe(false);
    expect(lineupIsReady(roster, starters, 999)).toBe(false);
  });

  it("rearranges players inside the same position row before confirmation", () => {
    const roster: LineupPlayer[] = [
      { id: 10, position: "FWD" },
      { id: 11, position: "FWD" },
      { id: 12, position: "FWD" },
    ];
    expect(reorderWithinPosition(roster, [10, 11, 12], 12, 10)).toEqual([12, 10, 11]);
  });

  it("does not move a player into a different position row", () => {
    const roster: LineupPlayer[] = [
      { id: 10, position: "FWD" },
      { id: 20, position: "MID" },
    ];
    expect(reorderWithinPosition(roster, [10, 20], 10, 20)).toBeNull();
  });
});
