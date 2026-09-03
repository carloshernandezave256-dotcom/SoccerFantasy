import { describe, expect, it } from "vitest";
import { managerTrend, matchupForecast, type ManagerTrend, type PreviewMatchup } from "./matchup-preview";

const matchups: PreviewMatchup[] = [
  { gameweek: 1, home_user_id: "home", away_user_id: "away", home_score: 90, away_score: 80, status: "final" },
  { gameweek: 2, home_user_id: "other", away_user_id: "home", home_score: 70, away_score: 100, status: "final" },
  { gameweek: 3, home_user_id: "home", away_user_id: "away", home_score: 0, away_score: 0, status: "scheduled" },
];

describe("matchup preview metrics", () => {
  it("builds manager form and averages only from completed earlier weeks", () => {
    expect(managerTrend(matchups, "home", 3)).toEqual({
      played: 2,
      pointsFor: 190,
      pointsAgainst: 150,
      averageFor: 95,
      averageAgainst: 75,
      form: ["W", "W"],
    });
  });

  it("creates a neutral forecast before both managers have history", () => {
    const empty = managerTrend([], "home", 1);
    expect(matchupForecast(empty, empty)).toMatchObject({ homeShare: 50, awayShare: 50, leader: "even" });
  });

  it("combines scoring average with the opponent's points allowed", () => {
    const home: ManagerTrend = { played: 2, pointsFor: 200, pointsAgainst: 120, averageFor: 100, averageAgainst: 60, form: ["W"] };
    const away: ManagerTrend = { played: 2, pointsFor: 160, pointsAgainst: 180, averageFor: 80, averageAgainst: 90, form: ["L"] };
    expect(matchupForecast(home, away)).toMatchObject({ homeScore: 95, awayScore: 70, homeShare: 58, awayShare: 42, leader: "home" });
  });
});
