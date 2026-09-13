import {describe,expect,it} from "vitest";
import {fantasyWeekWindow,fixtureInsideFantasyWeek,fixturesForFantasyWeek} from "./fantasy-week-window";

describe("fantasy week kickoff window",()=>{
  it("includes Friday when the calendar round starts Saturday",()=>{
    const weekend=fantasyWeekWindow([{kickoff:"2026-09-12T14:00:00Z"}])!;
    expect(weekend.startsAt).toBe("2026-09-11T00:00:00.000Z");
    expect(fixtureInsideFantasyWeek({kickoff:"2026-09-11T18:45:00Z"},weekend)).toBe(true);
    expect(fixtureInsideFantasyWeek({kickoff:"2026-09-18T18:45:00Z"},weekend)).toBe(false);
  });

  it("keeps Madrid and Barcelona round 5 when a larger midweek round 6 follows",()=>{
    const weekend=fantasyWeekWindow([{kickoff:"2026-09-12T14:00:00Z"}])!;
    const fixtures=[
      {competition:"La Liga",officialRound:5,kickoff:"2026-09-12T19:00:00Z"},
      {competition:"La Liga",officialRound:5,kickoff:"2026-09-13T14:15:00Z"},
      ...Array.from({length:10},()=>({competition:"La Liga",officialRound:6,kickoff:"2026-09-16T19:00:00Z"})),
      {competition:"La Liga",officialRound:3,kickoff:"2026-09-14T19:00:00Z"},
    ];
    expect(fixturesForFantasyWeek(fixtures,weekend).map(f=>f.officialRound)).toEqual([5,5]);
    expect(fixturesForFantasyWeek([...fixtures].reverse(),weekend)).toEqual(fixtures.slice(0,2).reverse());
  });

  it("retains a selected round's Tuesday finish but excludes another round",()=>{
    const weekend=fantasyWeekWindow([{kickoff:"2026-09-12T14:00:00Z"}])!;
    const fixtures=[
      {competition:"La Liga",officialRound:5,kickoff:"2026-09-12T19:00:00Z"},
      {competition:"La Liga",officialRound:5,kickoff:"2026-09-15T19:00:00Z"},
      {competition:"La Liga",officialRound:6,kickoff:"2026-09-16T19:00:00Z"},
    ];
    expect(fixturesForFantasyWeek(fixtures,weekend)).toEqual(fixtures.slice(0,2));
  });

  it("does not substitute a catch-up round when the configured round is absent",()=>{
    const weekend=fantasyWeekWindow([{kickoff:"2026-09-12T14:00:00Z"}])!;
    expect(fixturesForFantasyWeek([
      {competition:"Premier League",officialRound:3,kickoff:"2026-09-12T19:00:00Z"},
    ],weekend,{"Premier League":4})).toEqual([]);
  });
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

  it("maps a late-starting Bundesliga round one into Fantasy GW2",()=>{
    const selected=fixturesForFantasyWeek([
      {competition:"Premier League",officialRound:2,kickoff:"2026-08-28T19:00:00.000Z"},
      {competition:"Bundesliga",officialRound:1,kickoff:"2026-08-28T18:30:00.000Z"},
      {competition:"Bundesliga",officialRound:1,kickoff:"2026-08-29T13:30:00.000Z"},
    ],window!);
    expect(selected.filter(fixture=>fixture.competition==="Bundesliga"))
      .toHaveLength(2);
  });

  it("keeps a postponed prior round history-only when the current round dominates the window",()=>{
    const gw1Window=fantasyWeekWindow([
      {kickoff:"2026-08-21T19:00:00.000Z"},
    ])!;
    const selected=fixturesForFantasyWeek([
      {competition:"La Liga",officialRound:2,kickoff:"2026-08-22T15:00:00.000Z"},
      {competition:"La Liga",officialRound:2,kickoff:"2026-08-22T19:30:00.000Z"},
      {competition:"La Liga",officialRound:1,kickoff:"2026-08-26T19:00:00.000Z"},
    ],gw1Window);
    expect(selected.map(fixture=>fixture.officialRound)).toEqual([2,2]);
  });

  it("always follows the configured calendar competition's active round",()=>{
    const selected=fixturesForFantasyWeek([
      {competition:"Premier League",officialRound:1,kickoff:"2026-08-28T18:00:00.000Z"},
      {competition:"Premier League",officialRound:1,kickoff:"2026-08-28T18:30:00.000Z"},
      {competition:"Premier League",officialRound:2,kickoff:"2026-08-28T19:00:00.000Z"},
    ],window!,{"Premier League":2});
    expect(selected.map(fixture=>fixture.officialRound)).toEqual([2]);
  });
});
