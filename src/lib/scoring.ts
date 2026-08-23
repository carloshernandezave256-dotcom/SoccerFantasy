export type Position = "GK" | "DEF" | "MID" | "FWD";

export interface PlayerMatchStats {
  position: Position;
  minutes: number;
  goals?: number;
  assists?: number;
  shotsOnTarget?: number;
  completedPasses?: number;
  tacklesWon?: number;
  penaltyGoals?: number;
  penaltiesMissed?: number;
  penaltiesConceded?: number;
  saves?: number;
  penaltiesSaved?: number;
  goalsConceded?: number;
  yellowCards?: number;
  secondYellowCards?: number;
  redCards?: number;
  ownGoals?: number;
  manOfTheMatch?: boolean;
  captain?: boolean;
  status?: "not_started" | "live" | "final";
}

export interface LedgerEntry { code: string; label: string; detail: string; points: number }
export interface ScoreResult { total: number; entries: LedgerEntry[] }

export function isTerminalMatchStatus(status: string): boolean {
  return new Set(["final", "FT", "AET", "PEN", "PST", "CANC", "ABD", "AWD", "WO"]).has(status);
}

export function resolvePlayerScoreStatus(
  playerFixtureStatuses: string[],
  gameweekIsFinal: boolean,
): "live" | "final" {
  if (playerFixtureStatuses.length > 0) {
    return playerFixtureStatuses.every(isTerminalMatchStatus) ? "final" : "live";
  }
  return gameweekIsFinal ? "final" : "live";
}

const goalPoints: Record<Position, number> = { GK: 7, DEF: 5, MID: 4, FWD: 3 };
const baseHatTrickBonus: Record<Position, number> = { GK: 9, DEF: 5, MID: 3, FWD: 1 };

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function concededPenalty(goals: number): number {
  if (goals < 2) return 0;
  return -(goals * 2 - 3);
}

export function calculateScore(stats: PlayerMatchStats): ScoreResult {
  const entries: LedgerEntry[] = [];
  const add = (code: string, label: string, detail: string, points: number) => {
    if (points !== 0) entries.push({ code, label, detail, points });
  };

  if (stats.minutes > 0) add("minutes", "Playing time", `${stats.minutes} minutes`, stats.minutes >= 60 ? 2 : 1);

  const goals = stats.goals ?? 0;
  const penaltyGoals = Math.min(stats.penaltyGoals ?? 0, goals);
  const openPlayGoals = Math.max(goals - penaltyGoals, 0);
  const hatTrickBonus = baseHatTrickBonus[stats.position]
    + Math.min(penaltyGoals, 3) * (goalPoints[stats.position] - 2);
  add("goals", "Non-penalty goals", `${countLabel(openPlayGoals, "non-penalty goal")} · ${goalPoints[stats.position]} FP each for a ${stats.position}`, openPlayGoals * goalPoints[stats.position]);
  if (goals >= 3) add("hat-trick", "Hat-trick bonus", `${countLabel(goals, "goal")} including penalties · ${hatTrickBonus} FP bonus for a ${stats.position}`, hatTrickBonus);
  add("assists", "Assists", `${countLabel(stats.assists ?? 0, "assist")} · 2 FP each`, (stats.assists ?? 0) * 2);

  // Latest Dreamflow clarifications supersede the earlier spreadsheet thresholds.
  add("shots-on-target", "Shots on target", `${countLabel(stats.shotsOnTarget ?? 0, "shot")} on target · 1 FP for every 3`, Math.floor((stats.shotsOnTarget ?? 0) / 3));
  add("passes", "Completed passes", `${countLabel(stats.completedPasses ?? 0, "completed pass", "completed passes")} · 1 FP for every 10`, Math.floor((stats.completedPasses ?? 0) / 10));
  if (stats.position !== "MID") {
    add("tackles", "Tackles won", `${countLabel(stats.tacklesWon ?? 0, "tackle")} won · 1 FP for every 3`, Math.floor((stats.tacklesWon ?? 0) / 3));
  }
  add("penalty-goals", "Penalty goals", `${countLabel(penaltyGoals, "penalty")} scored · 2 FP each, regardless of position`, penaltyGoals * 2);
  add("penalties-missed", "Penalties missed", `${countLabel(stats.penaltiesMissed ?? 0, "penalty")} missed · −2 FP each`, -(stats.penaltiesMissed ?? 0) * 2);
  add("penalties-conceded", "Penalties conceded", `${countLabel(stats.penaltiesConceded ?? 0, "penalty")} conceded · −2 FP each`, -(stats.penaltiesConceded ?? 0) * 2);

  if (stats.position === "GK") {
    add("saves", "Saves", `${countLabel(stats.saves ?? 0, "save")} · 1 FP for every 3`, Math.floor((stats.saves ?? 0) / 3));
    add("penalties-saved", "Penalties saved", `${countLabel(stats.penaltiesSaved ?? 0, "penalty")} saved · 2 FP each`, (stats.penaltiesSaved ?? 0) * 2);
  }

  if (stats.minutes > 0 && stats.status !== "live" && stats.status !== "not_started") {
    const conceded = stats.goalsConceded ?? 0;
    const cleanSheetPoints: Record<Position, number> = { GK: 3, DEF: 3, MID: 1, FWD: 0 };
    if (conceded === 0) add("clean-sheet", "Clean sheet", `Team finished with a clean sheet · ${cleanSheetPoints[stats.position]} FP for any appearance as a ${stats.position}`, cleanSheetPoints[stats.position]);
  }

  if ((stats.position === "GK" || stats.position === "DEF") && stats.minutes >= 60) {
    const conceded = stats.goalsConceded ?? 0;
    add("goals-conceded", "Goals conceded", `${countLabel(conceded, "goal")} conceded · deductions begin at 2`, concededPenalty(conceded));
  }

  add("yellow", "Yellow cards", `${countLabel(stats.yellowCards ?? 0, "yellow card")} · −1 FP each`, -(stats.yellowCards ?? 0));
  add("second-yellow", "Second-yellow dismissals", `${countLabel(stats.secondYellowCards ?? 0, "second-yellow dismissal")} · −2 FP each`, -(stats.secondYellowCards ?? 0) * 2);
  add("red", "Straight red cards", `${countLabel(stats.redCards ?? 0, "straight red card")} · −3 FP each`, -(stats.redCards ?? 0) * 3);
  add("own-goals", "Own goals", `${countLabel(stats.ownGoals ?? 0, "own goal")} · −3 FP each`, -(stats.ownGoals ?? 0) * 3);
  if (stats.manOfTheMatch) add("motm", "Man of the Match", "Man of the Match · 2 FP", 2);
  if (stats.captain) {
    const baseTotal = entries.reduce((sum, entry) => sum + entry.points, 0);
    const captainTotal = Math.floor(baseTotal * 1.5);
    entries.push({
      code: "captain-bonus",
      label: "Captain +50%",
      detail: "Captain earns 50% additional fantasy points · final score rounded down",
      points: captainTotal - baseTotal,
    });
  }

  return { total: entries.reduce((sum, entry) => sum + entry.points, 0), entries };
}
