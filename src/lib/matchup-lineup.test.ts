import { describe, expect, it } from "vitest";
import { partitionMatchupLineup, selectMatchupLineup } from "./matchup-lineup";

describe("matchup lineup selection", () => {
  const current = [{ id: "current", is_starter: false }];
  const snapshot = [{ id: "locked", is_starter: false }];

  it("uses the editable lineup before the gameweek starts", () => {
    expect(selectMatchupLineup("scheduled", current, snapshot)).toBe(current);
  });

  it.each(["live", "final"] as const)("uses the locked snapshot when the matchup is %s", (status) => {
    expect(selectMatchupLineup(status, current, snapshot)).toBe(snapshot);
  });

  it("keeps starters and bench players separate", () => {
    expect(partitionMatchupLineup([
      { id: 1, is_starter: true },
      { id: 2, is_starter: false },
      { id: 3, is_starter: false },
    ])).toEqual({
      starters: [{ id: 1, is_starter: true }],
      bench: [{ id: 2, is_starter: false }, { id: 3, is_starter: false }],
    });
  });

  it("preserves the saved pitch and bench arrangement", () => {
    expect(partitionMatchupLineup([
      { id: "right", is_starter: true, pitch_order: 3 },
      { id: "bench-two", is_starter: false, bench_order: 2 },
      { id: "left", is_starter: true, pitch_order: 1 },
      { id: "center", is_starter: true, pitch_order: 2 },
      { id: "bench-one", is_starter: false, bench_order: 1 },
    ])).toEqual({
      starters: [
        { id: "left", is_starter: true, pitch_order: 1 },
        { id: "center", is_starter: true, pitch_order: 2 },
        { id: "right", is_starter: true, pitch_order: 3 },
      ],
      bench: [
        { id: "bench-one", is_starter: false, bench_order: 1 },
        { id: "bench-two", is_starter: false, bench_order: 2 },
      ],
    });
  });
});
