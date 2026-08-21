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
}

export interface LedgerEntry { code: string; label: string; detail: string; points: number }
export interface ScoreResult { total: number; entries: LedgerEntry[] }

const goalPoints: Record<Position, number> = { GK: 7, DEF: 5, MID: 4, FWD: 3 };
const hatTrickBonus: Record<Position, number> = { GK: 9, DEF: 5, MID: 3, FWD: 1 };

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
  add("goals", "Goals", `${countLabel(goals, "goal")} · ${goalPoints[stats.position]} FP each for a ${stats.position}`, goals * goalPoints[stats.position]);
  if (goals >= 3) add("hat-trick", "Hat-trick bonus", `Extra ${hatTrickBonus[stats.position]} FP for a ${stats.position} scoring 3+ goals`, hatTrickBonus[stats.position]);
  add("assists", "Assists", `${countLabel(stats.assists ?? 0, "assist")} · 2 FP each`, (stats.assists ?? 0) * 2);

  // Latest Dreamflow clarifications supersede the earlier spreadsheet thresholds.
  add("shots-on-target", "Shots on target", `${countLabel(stats.shotsOnTarget ?? 0, "shot")} on target · 1 FP for every 3`, Math.floor((stats.shotsOnTarget ?? 0) / 3));
  add("passes", "Completed passes", `${countLabel(stats.completedPasses ?? 0, "completed pass", "completed passes")} · 1 FP for every 10`, Math.floor((stats.completedPasses ?? 0) / 10));
  add("tackles", "Tackles won", `${countLabel(stats.tacklesWon ?? 0, "tackle")} won · 1 FP for every 3`, Math.floor((stats.tacklesWon ?? 0) / 3));
  add("penalty-goals", "Penalties scored", `${countLabel(stats.penaltyGoals ?? 0, "penalty")} scored · 2 FP each`, (stats.penaltyGoals ?? 0) * 2);
  add("penalties-missed", "Penalties missed", `${countLabel(stats.penaltiesMissed ?? 0, "penalty")} missed · −2 FP each`, -(stats.penaltiesMissed ?? 0) * 2);
  add("penalties-conceded", "Penalties conceded", `${countLabel(stats.penaltiesConceded ?? 0, "penalty")} conceded · −2 FP each`, -(stats.penaltiesConceded ?? 0) * 2);

  if (stats.position === "GK") {
    add("saves", "Saves", `${countLabel(stats.saves ?? 0, "save")} · 1 FP for every 3`, Math.floor((stats.saves ?? 0) / 3));
    add("penalties-saved", "Penalties saved", `${countLabel(stats.penaltiesSaved ?? 0, "penalty")} saved · 2 FP each`, (stats.penaltiesSaved ?? 0) * 2);
  }

  if ((stats.position === "GK" || stats.position === "DEF") && stats.minutes >= 60) {
    const conceded = stats.goalsConceded ?? 0;
    if (conceded === 0) add("clean-sheet", "Clean sheet", "60+ minutes, no goals conceded", 3);
    add("goals-conceded", "Goals conceded", `${countLabel(conceded, "goal")} conceded · deductions begin at 2`, concededPenalty(conceded));
  }

  add("yellow", "Yellow cards", `${countLabel(stats.yellowCards ?? 0, "yellow card")} · −1 FP each`, -(stats.yellowCards ?? 0));
  add("second-yellow", "Second-yellow dismissals", `${countLabel(stats.secondYellowCards ?? 0, "second-yellow dismissal")} · −2 FP each`, -(stats.secondYellowCards ?? 0) * 2);
  add("red", "Straight red cards", `${countLabel(stats.redCards ?? 0, "straight red card")} · −3 FP each`, -(stats.redCards ?? 0) * 3);
  add("own-goals", "Own goals", `${countLabel(stats.ownGoals ?? 0, "own goal")} · −3 FP each`, -(stats.ownGoals ?? 0) * 3);
  if (stats.captain) {
    const baseTotal = entries.reduce((sum, entry) => sum + entry.points, 0);
    entries.push({
      code: "captain-bonus",
      label: "Captain +50%",
      detail: "Captain earns 50% additional fantasy points",
      points: baseTotal * 0.5,
    });
  }

  return { total: entries.reduce((sum, entry) => sum + entry.points, 0), entries };
}
