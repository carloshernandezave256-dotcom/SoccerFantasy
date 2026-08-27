import {describe,expect,it} from "vitest";
import {fantasyWeekWindow,fixtureInsideFantasyWeek} from "./fantasy-week-window";

describe("fantasy week kickoff window",()=>{
  const window=fantasyWeekWindow([
    {kickoff:"2026-08-28T19:00:00.000Z"},
    {kickoff:"2026-08-31T19:00:00.000Z"},
  ]);

  it("includes an opening-round match before the calendar league's first kickoff",()=>{
    expect(window).not.toBeNull();
    expect(fixtureInsideFantasyWeek(
      {kickoff:"2026-08-28T18:30:00.000Z"},
      window!,
    )).toBe(true);
  });

  it("includes other Top Five games from the same fantasy week",()=>{
    expect(fixtureInsideFantasyWeek(
      {kickoff:"2026-08-27T18:30:00.000Z"},
      window!,
    )).toBe(true);
  });

  it("excludes games from the following weekend during a calendar-league bye",()=>{
    expect(fixtureInsideFantasyWeek(
      {kickoff:"2026-09-04T18:30:00.000Z"},
      window!,
    )).toBe(false);
  });
});
