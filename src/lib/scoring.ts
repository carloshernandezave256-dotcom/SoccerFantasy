export type Position = "GK" | "DEF" | "MID" | "FWD";

export interface PlayerMatchStats {
  position: Position;
  minutes: number;
  goals?: number;
  assists?: number;
  shotsOnTarget?: number;
  bigChancesMissed?: number;
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
  add("goals", "Goals", `${goals} × ${goalPoints[stats.position]} (${stats.position})`, goals * goalPoints[stats.position]);
  if (goals >= 3) add("hat-trick", "Hat-trick bonus", `Position bonus for ${stats.position}`, hatTrickBonus[stats.position]);
  add("assists", "Assists", `${stats.assists ?? 0} × 2`, (stats.assists ?? 0) * 2);

  // Latest Dreamflow clarifications supersede the earlier spreadsheet thresholds.
  add("shots-on-target", "Shots on target", `${stats.shotsOnTarget ?? 0} × 1`, stats.shotsOnTarget ?? 0);
  add("big-chances-missed", "Big chances missed", `${stats.bigChancesMissed ?? 0} × −1`, -(stats.bigChancesMissed ?? 0));
  add("passes", "Completed passes", `${Math.floor((stats.completedPasses ?? 0) / 10)} blocks of 10`, Math.floor((stats.completedPasses ?? 0) / 10));
  add("tackles", "Tackles won", `${Math.floor((stats.tacklesWon ?? 0) / 3)} blocks of 3`, Math.floor((stats.tacklesWon ?? 0) / 3));
  add("penalty-goals", "Penalties scored", `${stats.penaltyGoals ?? 0} × 2`, (stats.penaltyGoals ?? 0) * 2);
  add("penalties-missed", "Penalties missed", `${stats.penaltiesMissed ?? 0} × −2`, -(stats.penaltiesMissed ?? 0) * 2);
  add("penalties-conceded", "Penalties conceded", `${stats.penaltiesConceded ?? 0} × −2`, -(stats.penaltiesConceded ?? 0) * 2);

  if (stats.position === "GK") {
    add("saves", "Saves", `${Math.floor((stats.saves ?? 0) / 3)} blocks of 3`, Math.floor((stats.saves ?? 0) / 3));
    add("penalties-saved", "Penalties saved", `${stats.penaltiesSaved ?? 0} × 2`, (stats.penaltiesSaved ?? 0) * 2);
  }

  if ((stats.position === "GK" || stats.position === "DEF") && stats.minutes >= 60) {
    const conceded = stats.goalsConceded ?? 0;
    if (conceded === 0) add("clean-sheet", "Clean sheet", "60+ minutes, no goals conceded", 3);
    add("goals-conceded", "Goals conceded", `${conceded} conceded`, concededPenalty(conceded));
  }

  add("yellow", "Yellow cards", `${stats.yellowCards ?? 0} × −1`, -(stats.yellowCards ?? 0));
  add("second-yellow", "Second-yellow dismissals", `${stats.secondYellowCards ?? 0} × −2`, -(stats.secondYellowCards ?? 0) * 2);
  add("red", "Straight red cards", `${stats.redCards ?? 0} × −3`, -(stats.redCards ?? 0) * 3);
  add("own-goals", "Own goals", `${stats.ownGoals ?? 0} × −3`, -(stats.ownGoals ?? 0) * 3);
  if (stats.manOfTheMatch) {
    add("motm", "Man of the Match", "Match award", 1);
    if (stats.captain) add("captain-motm", "Captain prediction bonus", "Your captain won Man of the Match", 4);
  }

  return { total: entries.reduce((sum, entry) => sum + entry.points, 0), entries };
}
