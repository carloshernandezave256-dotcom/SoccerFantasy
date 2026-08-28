import {describe,expect,it} from "vitest";
import {fantasyWeekWindow,fixtureInsideFantasyWeek} from "./fantasy-week-window";

describe("fantasy week kickoff window",()=>{
  const window=fantasyWeekWindow([
    {kickoff:"2026-08-28T19:00:00.000Z"},
    {kickoff:"2026-08-31T19:00:00.000Z"},
  ]);

  it("includes matches earlier on the calendar league's opening day",()=>{
    expect(window).not.toBeNull();
    expect(fixtureInsideFantasyWeek(
      {kickoff:"2026-08-28T18:30:00.000Z"},
      window!,
    )).toBe(true);
  });

  it("does not leak delayed matches from the prior fantasy week",()=>{
    expect(fixtureInsideFantasyWeek(
      {kickoff:"2026-08-27T18:30:00.000Z"},
      window!,
    )).toBe(false);
  });

  it("excludes games from the following weekend during a calendar-league bye",()=>{
    expect(fixtureInsideFantasyWeek(
      {kickoff:"2026-09-04T18:30:00.000Z"},
      window!,
    )).toBe(false);
  });

  it("maps EPL fantasy GW2 to La Liga GW3 without counting delayed La Liga GW1",()=>{
    expect(fixtureInsideFantasyWeek(
      {kickoff:"2026-08-26T19:00:00.000Z"}, // La Liga official GW1, history only
      window!,
    )).toBe(false);
    expect(fixtureInsideFantasyWeek(
      {kickoff:"2026-08-28T19:30:00.000Z"}, // La Liga official GW3
      window!,
    )).toBe(true);
  });
});
