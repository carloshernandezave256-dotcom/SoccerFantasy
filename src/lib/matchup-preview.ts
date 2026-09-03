export type PreviewMatchup = {
  gameweek: number;
  home_user_id: string;
  away_user_id: string;
  home_score: number | string;
  away_score: number | string;
  status: "scheduled" | "live" | "final";
};

export type ManagerTrend = {
  played: number;
  pointsFor: number;
  pointsAgainst: number;
  averageFor: number;
  averageAgainst: number;
  form: Array<"W" | "D" | "L">;
};

export type ProjectionFixture = {
  status: string;
  kickoff: string;
  home_team: string;
  away_team: string;
  home_score: number | null;
  away_score: number | null;
};

export type ProjectionPlayer = {
  id: number;
  position: string;
  club: string;
  captain?: boolean;
  injured?: boolean;
  fixture: Pick<ProjectionFixture, "home_team" | "away_team"> | null;
  seasonPoints: number;
  appearances: number;
  recentPoints?: number[];
};

export type PlayerProjection = {
  playerId: number;
  expectedPoints: number;
  pointsPerAppearance: number;
  opponent: string | null;
  opponentFactor: number;
  appearanceRate: number;
  formAverage: number | null;
};

const terminalStatuses = new Set(["FT", "AET", "PEN", "FINAL"]);
const positionBaseline: Record<string, number> = { GK: 4.1, DEF: 4.9, MID: 4.4, FWD: 3 };

function normalizedClub(name: string) {
  return name.toLocaleLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
}

function clubRecord(fixtures: ProjectionFixture[], club: string) {
  const normalized = normalizedClub(club);
  return fixtures.reduce((record, fixture) => {
    const home = normalizedClub(fixture.home_team) === normalized;
    const away = normalizedClub(fixture.away_team) === normalized;
    if ((!home && !away) || fixture.home_score === null || fixture.away_score === null || !terminalStatuses.has(fixture.status.toUpperCase())) return record;
    record.played += 1;
    record.goalsFor += home ? fixture.home_score : fixture.away_score;
    record.goalsAgainst += home ? fixture.away_score : fixture.home_score;
    return record;
  }, { played: 0, goalsFor: 0, goalsAgainst: 0 });
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function projectPlayerPoints(player: ProjectionPlayer, fixtures: ProjectionFixture[]): PlayerProjection {
  const pointsPerAppearance = player.appearances ? player.seasonPoints / player.appearances : 0;
  const recentPoints = (player.recentPoints ?? []).slice(0, 3);
  const recentWeights = [3, 2, 1].slice(0, recentPoints.length);
  const formAverage = recentPoints.length
    ? recentPoints.reduce((total, points, index) => total + points * recentWeights[index], 0) / recentWeights.reduce((total, weight) => total + weight, 0)
    : null;
  if (!player.fixture || !player.appearances || player.injured) {
    return { playerId: player.id, expectedPoints: 0, pointsPerAppearance, opponent: null, opponentFactor: 1, appearanceRate: 0, formAverage };
  }

  const club = normalizedClub(player.club);
  const isHome = normalizedClub(player.fixture.home_team) === club;
  const opponent = isHome ? player.fixture.away_team : player.fixture.home_team;
  const completed = fixtures.filter(fixture => fixture.home_score !== null && fixture.away_score !== null && terminalStatuses.has(fixture.status.toUpperCase()));
  const leagueGoalsPerTeam = completed.length
    ? completed.reduce((goals, fixture) => goals + Number(fixture.home_score) + Number(fixture.away_score), 0) / (completed.length * 2)
    : 1.35;
  const opponentRecord = clubRecord(completed, opponent);
  const opponentAttack = opponentRecord.played ? (opponentRecord.goalsFor / opponentRecord.played) / Math.max(leagueGoalsPerTeam, 0.5) : 1;
  const opponentDefense = opponentRecord.played ? (opponentRecord.goalsAgainst / opponentRecord.played) / Math.max(leagueGoalsPerTeam, 0.5) : 1;
  const attackEase = clamp(opponentDefense, 0.7, 1.3);
  const cleanSheetEase = clamp(2 - opponentAttack, 0.7, 1.3);
  const opponentFactor = player.position === "FWD"
    ? 0.65 + 0.35 * attackEase
    : player.position === "MID"
      ? 0.75 + 0.25 * attackEase
      : player.position === "DEF"
        ? 0.65 + 0.35 * cleanSheetEase
        : 0.7 + 0.3 * cleanSheetEase;
  // A missed match may be rest, rotation, or a transfer completed after the
  // season began. A healthy fantasy starter is therefore projected to play;
  // sparse early-season samples are stabilized against the position average.
  const priorAppearances = Math.max(0, 3 - player.appearances);
  const stabilizedAverage = (player.seasonPoints + (positionBaseline[player.position] ?? 4) * priorAppearances) / (player.appearances + priorAppearances);
  // Recent form matters, but remains a supporting signal: the newest of the
  // last three scores receives the most weight and the whole form adjustment
  // is capped at 35% of the player's stabilized season baseline.
  const formWeight = formAverage === null ? 0 : Math.min(0.35, recentPoints.length * 0.12);
  const formAdjustedAverage = stabilizedAverage * (1 - formWeight) + (formAverage ?? stabilizedAverage) * formWeight;
  const appearanceRate = 1;
  const venueFactor = isHome ? 1.03 : 0.97;
  const captainFactor = player.captain ? 1.5 : 1;
  const expectedPoints = Math.max(0, formAdjustedAverage * opponentFactor * venueFactor * captainFactor);

  return {
    playerId: player.id,
    expectedPoints: Math.round(expectedPoints * 10) / 10,
    pointsPerAppearance: Math.round(pointsPerAppearance * 10) / 10,
    opponent,
    opponentFactor: Math.round(opponentFactor * 100) / 100,
    appearanceRate: Math.round(appearanceRate * 100) / 100,
    formAverage: formAverage === null ? null : Math.round(formAverage * 10) / 10,
  };
}

export function projectedLineupForecast(homePlayers: PlayerProjection[], awayPlayers: PlayerProjection[]) {
  const homeScore = homePlayers.reduce((total, player) => total + player.expectedPoints, 0);
  const awayScore = awayPlayers.reduce((total, player) => total + player.expectedPoints, 0);
  const combined = homeScore + awayScore;
  const homeShare = combined ? Math.round((homeScore / combined) * 100) : 50;
  return {
    homeScore,
    awayScore,
    homeShare,
    awayShare: 100 - homeShare,
    leader: Math.abs(homeScore - awayScore) < 0.5 ? "even" as const : homeScore > awayScore ? "home" as const : "away" as const,
  };
}

export function managerTrend(matchups: PreviewMatchup[], userId: string, beforeGameweek: number): ManagerTrend {
  const completed = matchups
    .filter(matchup => matchup.status === "final" && matchup.gameweek < beforeGameweek && (matchup.home_user_id === userId || matchup.away_user_id === userId))
    .sort((left, right) => left.gameweek - right.gameweek);

  const totals = completed.reduce((result, matchup) => {
    const isHome = matchup.home_user_id === userId;
    const scored = Number(isHome ? matchup.home_score : matchup.away_score);
    const allowed = Number(isHome ? matchup.away_score : matchup.home_score);
    result.pointsFor += scored;
    result.pointsAgainst += allowed;
    result.form.push(scored > allowed ? "W" : scored < allowed ? "L" : "D");
    return result;
  }, { pointsFor: 0, pointsAgainst: 0, form: [] as Array<"W" | "D" | "L"> });

  const played = completed.length;
  return {
    played,
    pointsFor: totals.pointsFor,
    pointsAgainst: totals.pointsAgainst,
    averageFor: played ? totals.pointsFor / played : 0,
    averageAgainst: played ? totals.pointsAgainst / played : 0,
    form: totals.form.slice(-5),
  };
}

export function matchupForecast(home: ManagerTrend, away: ManagerTrend) {
  if (!home.played || !away.played) return { homeScore: 0, awayScore: 0, homeShare: 50, awayShare: 50, leader: "even" as const };

  const homeScore = (home.averageFor + away.averageAgainst) / 2;
  const awayScore = (away.averageFor + home.averageAgainst) / 2;
  const combined = homeScore + awayScore;
  const homeShare = combined ? Math.round((homeScore / combined) * 100) : 50;
  return {
    homeScore,
    awayScore,
    homeShare,
    awayShare: 100 - homeShare,
    leader: Math.abs(homeScore - awayScore) < 0.5 ? "even" as const : homeScore > awayScore ? "home" as const : "away" as const,
  };
}
