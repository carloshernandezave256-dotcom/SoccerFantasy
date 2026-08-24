import { isTerminalMatchStatus } from "./scoring";

export type PlayerDataStatus = "upcoming" | "live" | "final" | "did_not_play" | "stats_pending";

export type PlayerFixture = {
  status: string;
  kickoff: string;
  home_team: string;
  away_team: string;
};

const scheduledStatuses = new Set(["NS", "TBD"]);

export function normalizeClubName(name: string) {
  return name.toLocaleLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
}

export function fixtureForClub(fixtures: PlayerFixture[], club: string) {
  const normalizedClub = normalizeClubName(club);
  return fixtures.find((fixture) =>
    normalizeClubName(fixture.home_team) === normalizedClub
    || normalizeClubName(fixture.away_team) === normalizedClub
  ) ?? null;
}

export function resolvePlayerDataStatus({
  fixtureStatus,
  scoreStatus,
  minutes,
  statsReceived,
}: {
  fixtureStatus?: string | null;
  scoreStatus?: "not_started" | "live" | "final" | null;
  minutes: number;
  statsReceived: boolean;
}): PlayerDataStatus {
  if (fixtureStatus && scheduledStatuses.has(fixtureStatus)) return "upcoming";
  if (fixtureStatus && !isTerminalMatchStatus(fixtureStatus)) return "live";

  if (fixtureStatus && isTerminalMatchStatus(fixtureStatus)) {
    if (!statsReceived) return "stats_pending";
    return minutes > 0 ? "final" : "did_not_play";
  }

  if (scoreStatus === "live") return "live";
  if (scoreStatus === "final") {
    if (!statsReceived) return "stats_pending";
    return minutes > 0 ? "final" : "did_not_play";
  }
  return "upcoming";
}

export const playerDataStatusCopy: Record<PlayerDataStatus, { label: string; title: string; detail: string }> = {
  upcoming: {
    label: "UPCOMING",
    title: "Match has not started",
    detail: "This player’s score will begin updating when their club fixture starts.",
  },
  live: {
    label: "LIVE",
    title: "Match data is live",
    detail: "Statistics and fantasy points will keep updating as new provider data is stored.",
  },
  final: {
    label: "FT",
    title: "Final statistics received",
    detail: "The provider returned this player’s completed match statistics.",
  },
  did_not_play: {
    label: "DID NOT PLAY",
    title: "No appearance",
    detail: "The provider included this player in the final match data with zero minutes played.",
  },
  stats_pending: {
    label: "STATS PENDING",
    title: "Final statistics are still pending",
    detail: "The fixture is complete, but the provider has not returned this player’s statistics yet. The displayed 0 is not being treated as confirmed final data.",
  },
};
