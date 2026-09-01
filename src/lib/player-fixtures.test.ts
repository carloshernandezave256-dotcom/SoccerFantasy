import {describe,expect,it} from "vitest";
import {fixtureForClub,fixtureOpponent,fixtureVenue,isPlayersClub} from "./player-fixtures";

const fixture={fixture_id:1,gameweek:3,competition:"La Liga",kickoff:"2026-09-05T19:00:00Z",status:"NS",home_team:"FC Barcelona",away_team:"Real Betis",home_score:null,away_score:null};

describe("player fixture context",()=>{
  it("matches provider club prefixes and returns the opponent",()=>{
    expect(isPlayersClub("FC Barcelona","Barcelona")).toBe(true);
    expect(fixtureForClub([fixture],"Barcelona")).toEqual(fixture);
    expect(fixtureOpponent(fixture,"Barcelona")).toBe("Real Betis");
    expect(fixtureVenue(fixture,"Barcelona")).toBe("Home");
  });

  it("supports known provider aliases",()=>{
    expect(isPlayersClub("Paris Saint-Germain","PSG")).toBe(true);
    expect(isPlayersClub("Bayern München","Bayern Munich")).toBe(true);
  });
});
