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
