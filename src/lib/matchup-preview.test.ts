import { describe, expect, it } from "vitest";
import { managerTrend, matchupForecast, projectPlayerPoints, projectedLineupForecast, type ManagerTrend, type PreviewMatchup, type ProjectionFixture } from "./matchup-preview";

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

  it("adjusts an attacker's expected points for the actual opponent and venue", () => {
    const fixtures: ProjectionFixture[] = [
      { status: "FT", kickoff: "2026-08-15", home_team: "Chelsea", away_team: "Arsenal", home_score: 1, away_score: 3 },
      { status: "FT", kickoff: "2026-08-22", home_team: "Liverpool", away_team: "Chelsea", home_score: 3, away_score: 2 },
      { status: "FT", kickoff: "2026-08-22", home_team: "Arsenal", away_team: "Everton", home_score: 1, away_score: 0 },
    ];
    const projection = projectPlayerPoints({
      id: 9,
      position: "FWD",
      club: "Arsenal",
      fixture: { home_team: "Arsenal", away_team: "Chelsea" },
      seasonPoints: 20,
      appearances: 2,
    }, fixtures);
    expect(projection.opponent).toBe("Chelsea");
    expect(projection.pointsPerAppearance).toBe(10);
    expect(projection.opponentFactor).toBeGreaterThan(1);
    expect(projection.expectedPoints).toBeGreaterThan(8);
  });

  it("does not cut a healthy starter's projection because they missed an earlier match", () => {
    const fixtures: ProjectionFixture[] = [
      { status: "FT", kickoff: "2026-08-15", home_team: "PSG", away_team: "Lyon", home_score: 2, away_score: 0 },
      { status: "FT", kickoff: "2026-08-22", home_team: "Marseille", away_team: "PSG", home_score: 1, away_score: 1 },
    ];
    const projection = projectPlayerPoints({ id: 10, position: "FWD", club: "PSG", fixture: { home_team: "PSG", away_team: "Monaco" }, seasonPoints: 2, appearances: 1 }, fixtures);
    expect(projection.appearanceRate).toBe(1);
    expect(projection.expectedPoints).toBeGreaterThan(2);
  });

  it("rewards good recent form without replacing the season baseline", () => {
    const base = { id: 11, position: "MID", club: "Bayern", fixture: { home_team: "Bayern", away_team: "Leipzig" }, seasonPoints: 15, appearances: 3 };
    const normal = projectPlayerPoints(base, []);
    const inForm = projectPlayerPoints({ ...base, recentPoints: [12, 9, 6] }, []);
    expect(inForm.formAverage).toBe(10);
    expect(inForm.expectedPoints).toBeGreaterThan(normal.expectedPoints);
    expect(inForm.expectedPoints).toBeLessThan(10);
  });

  it("totals player-level projections for the matchup headline", () => {
    const base = { pointsPerAppearance: 8, opponent: "Opponent", opponentFactor: 1, appearanceRate: 1, formAverage: null };
    expect(projectedLineupForecast(
      [{ ...base, playerId: 1, expectedPoints: 12 }, { ...base, playerId: 2, expectedPoints: 8 }],
      [{ ...base, playerId: 3, expectedPoints: 10 }],
    )).toMatchObject({ homeScore: 20, awayScore: 10, homeShare: 67, awayShare: 33, leader: "home" });
  });

  it("does not project points for an unavailable player", () => {
    expect(projectPlayerPoints({ id: 7, position: "MID", club: "Milan", fixture: { home_team: "Milan", away_team: "Roma" }, seasonPoints: 18, appearances: 2, injured: true }, [])).toMatchObject({ expectedPoints: 0, appearanceRate: 0 });
  });
});
