import { completedPassesFromApi } from "./api-football-stats";
import { resolvePlayerScoreStatus, type LedgerEntry } from "./scoring";

export const TERMINAL_FIXTURE_STATUSES = new Set([
  "FT",
  "AET",
  "PEN",
  "PST",
  "CANC",
  "ABD",
  "AWD",
  "WO",
]);

export type CachedFixture = {
  fixture_id: number;
  status: string;
  kickoff: string;
  events_synced_at?: string | null;
};

export type ProviderFixtureEvent = {
  player: { id: number | null; name: string | null };
  type: string;
  detail: string;
};

export type ProviderFixture = {
  fixture: { id: number; date: string; status: { short: string } };
  league: { id: number; name: string };
  teams: { home: { id: number }; away: { id: number } };
  goals: { home: number | null; away: number | null };
};

export type ProviderPlayer = {
  player: { id: number; name: string };
  statistics: Array<{
    games: { minutes: number | null; rating: string | null; position: string | null };
    shots: { on: number | null };
    goals: { total: number | null; assists: number | null; conceded: number | null; saves: number | null };
    passes: { total: number | null; accuracy: number | string | null };
    tackles: { total: number | null };
    cards: { yellow: number | null; red: number | null };
    penalty: { scored: number | null; missed: number | null; saved: number | null; commited: number | null };
  }>;
};

export type ProviderTeamPlayers = {
  team: { id: number; name: string };
  players: ProviderPlayer[];
};

export type ProviderPlayerPage = {
  fixture: ProviderFixture;
  teams: ProviderTeamPlayers[];
};

export type FixturePlayerStatRow = Record<string, number | boolean | null | string> & {
  fixture_id: number;
  player_id: number;
};

export type UnmappedProviderPlayer = {
  api_football_id: number;
  name: string;
  team_id: number;
  team_name: string;
  position: string | null;
  minutes: number;
};

export type FixtureObservation = {
  fixture_id: number;
  observed_at: string;
  status: string;
  home_score: number | null;
  away_score: number | null;
  provider_player_rows: number;
  mapped_player_rows: number;
  unmapped_players: UnmappedProviderPlayer[];
};

export type PlayerClubAppearance = {
  fixture_id: number;
  player_id: number;
  club: string;
  competition: string;
  kickoff: string;
  observed_at: string;
};

export type WeekFixture = {
  fixture_id: number;
  status: string;
  kickoff: string;
  competition: string;
  gameweek: number;
};

export type LeaguePlayerScoreRow = {
  league_id: string;
  gameweek: number;
  player_id: number;
  rating: number | null;
  minutes: number;
  goals: number;
  assists: number;
  shots_on_target: number;
  big_chances_missed: number;
  completed_passes: number;
  tackles_won: number;
  penalty_goals: number;
  penalties_missed: number;
  penalties_conceded: number;
  saves: number;
  penalties_saved: number;
  goals_conceded: number;
  yellow_cards: number;
  second_yellow_cards: number;
  red_cards: number;
  own_goals: number;
  man_of_the_match: false;
  stats_received: boolean;
  status: "live" | "final";
  source: "api-football-fixture-sum";
  source_updated_at: string;
  updated_at: string;
  fantasy_points: number;
  score_ledger: LedgerEntry[];
  calculator_version: "fixture-sum-v1";
};

export function reconcileFixtureStatus(
  providerStatus: string,
  cachedStatus: string | undefined,
  priorProviderStatus: string | undefined,
): string {
  if (!TERMINAL_FIXTURE_STATUSES.has(providerStatus)) return providerStatus;
  if (priorProviderStatus && TERMINAL_FIXTURE_STATUSES.has(priorProviderStatus)) return providerStatus;
  return cachedStatus ?? providerStatus;
}

export function partitionProviderFixtures(candidates: CachedFixture[], liveFixtures: ProviderFixture[]) {
  const candidateIds = new Set(candidates.map((fixture) => fixture.fixture_id));
  const eligibleLiveFixtures = liveFixtures.filter((fixture) => candidateIds.has(fixture.fixture.id));
  const liveIds = new Set(eligibleLiveFixtures.map((fixture) => fixture.fixture.id));
  const droppedCandidates = candidates.filter((fixture) => !liveIds.has(fixture.fixture_id));
  return { liveFixtures: eligibleLiveFixtures, droppedCandidates };
}

export function providerPlayerIds(pages: ProviderPlayerPage[]): number[] {
  return [
    ...new Set(
      pages.flatMap(({ teams }) =>
        teams.flatMap((team) => team.players.map((entry) => entry.player.id)),
      ),
    ),
  ];
}

export function normalizeProviderPlayerPages(
  pages: ProviderPlayerPage[],
  internalPlayerIdByApiId: ReadonlyMap<number, number>,
  observedAt: string,
  ownGoalsByFixtureAndApiPlayer: ReadonlyMap<number, ReadonlyMap<number, number>> = new Map(),
): {
  rows: FixturePlayerStatRow[];
  observations: FixtureObservation[];
  clubAppearances: PlayerClubAppearance[];
} {
  const rows: FixturePlayerStatRow[] = [];
  const observations: FixtureObservation[] = [];
  const clubAppearances: PlayerClubAppearance[] = [];

  for (const { fixture, teams } of pages) {
    const entries = teams.flatMap((team) =>
      team.players.flatMap((entry) =>
        entry.statistics.slice(0, 1).map((stat) => ({ entry, stat, team })),
      ),
    );
    const unmappedPlayers: UnmappedProviderPlayer[] = [];
    let mappedPlayerRows = 0;

    for (const { entry, stat, team } of entries) {
      const playerId = internalPlayerIdByApiId.get(entry.player.id);
      if (!playerId) {
        unmappedPlayers.push({
          api_football_id: entry.player.id,
          name: entry.player.name,
          team_id: team.team.id,
          team_name: team.team.name,
          position: stat.games.position,
          minutes: stat.games.minutes ?? 0,
        });
        continue;
      }

      const teamGoalsConceded = team.team.id === fixture.teams.home.id
        ? fixture.goals.away
        : team.team.id === fixture.teams.away.id
          ? fixture.goals.home
          : null;
      const fixtureOwnGoals = ownGoalsByFixtureAndApiPlayer.get(fixture.fixture.id);
      rows.push({
        fixture_id: fixture.fixture.id,
        player_id: playerId,
        rating: Number(stat.games.rating) || null,
        minutes: stat.games.minutes ?? 0,
        goals: stat.goals.total ?? 0,
        assists: stat.goals.assists ?? 0,
        shots_on_target: stat.shots.on ?? 0,
        completed_passes: completedPassesFromApi(stat.passes.total, stat.passes.accuracy),
        tackles_won: stat.tackles.total ?? 0,
        penalty_goals: stat.penalty.scored ?? 0,
        penalties_missed: stat.penalty.missed ?? 0,
        penalties_conceded: stat.penalty.commited ?? 0,
        saves: stat.goals.saves ?? 0,
        penalties_saved: stat.penalty.saved ?? 0,
        goals_conceded: teamGoalsConceded ?? stat.goals.conceded ?? 0,
        yellow_cards: stat.cards.yellow ?? 0,
        red_cards: stat.cards.red ?? 0,
        ...(fixtureOwnGoals ? { own_goals: fixtureOwnGoals.get(entry.player.id) ?? 0 } : {}),
        man_of_the_match: false,
        source_updated_at: observedAt,
      });
      if ((stat.games.minutes ?? 0) > 0) {
        clubAppearances.push({
          fixture_id: fixture.fixture.id,
          player_id: playerId,
          club: team.team.name,
          competition: fixture.league.name,
          kickoff: fixture.fixture.date,
          observed_at: observedAt,
        });
      }
      mappedPlayerRows += 1;
    }

    observations.push({
      fixture_id: fixture.fixture.id,
      observed_at: observedAt,
      status: fixture.fixture.status.short,
      home_score: fixture.goals.home,
      away_score: fixture.goals.away,
      provider_player_rows: entries.length,
      mapped_player_rows: mappedPlayerRows,
      unmapped_players: unmappedPlayers,
    });
  }

  return { rows, observations, clubAppearances };
}

function sum(rows: FixturePlayerStatRow[], field: string) {
  return rows.reduce((total, row) => total + Number(row[field] ?? 0), 0);
}

function combinedLedger(rows: FixturePlayerStatRow[]) {
  return rows.flatMap((row) =>
    Array.isArray(row.score_ledger) ? row.score_ledger as LedgerEntry[] : []
  );
}

export function buildLeaguePlayerScoreRows({
  leagueId,
  gameweek,
  playerIds,
  fixtureStats,
  weekFixtures,
  updatedAt,
}: {
  leagueId: string;
  gameweek: number;
  playerIds: number[];
  fixtureStats: FixturePlayerStatRow[];
  weekFixtures: WeekFixture[];
  updatedAt: string;
}): LeaguePlayerScoreRow[] {
  const gameweekIsFinal = weekFixtures.length > 0
    && weekFixtures.every((fixture) => TERMINAL_FIXTURE_STATUSES.has(fixture.status));
  const fixtureStatusById = new Map(
    weekFixtures.map((fixture) => [fixture.fixture_id, fixture.status]),
  );

  return playerIds.map((playerId) => {
    const playerStats = fixtureStats.filter((stat) => stat.player_id === playerId);
    const ratings = playerStats.map((stat) => Number(stat.rating)).filter(Boolean);
    const playerFixtureStatuses = [
      ...new Set(
        playerStats
          .map((stat) => fixtureStatusById.get(stat.fixture_id))
          .filter((status): status is string => Boolean(status)),
      ),
    ];
    return {
      league_id: leagueId,
      gameweek,
      player_id: playerId,
      rating: ratings.length ? Math.max(...ratings) : null,
      minutes: sum(playerStats, "minutes"),
      goals: sum(playerStats, "goals"),
      assists: sum(playerStats, "assists"),
      shots_on_target: sum(playerStats, "shots_on_target"),
      big_chances_missed: 0,
      completed_passes: sum(playerStats, "completed_passes"),
      tackles_won: sum(playerStats, "tackles_won"),
      penalty_goals: sum(playerStats, "penalty_goals"),
      penalties_missed: sum(playerStats, "penalties_missed"),
      penalties_conceded: sum(playerStats, "penalties_conceded"),
      saves: sum(playerStats, "saves"),
      penalties_saved: sum(playerStats, "penalties_saved"),
      goals_conceded: sum(playerStats, "goals_conceded"),
      yellow_cards: sum(playerStats, "yellow_cards"),
      second_yellow_cards: 0,
      red_cards: sum(playerStats, "red_cards"),
      own_goals: sum(playerStats, "own_goals"),
      man_of_the_match: false,
      stats_received: playerStats.length > 0,
      status: resolvePlayerScoreStatus(playerFixtureStatuses, gameweekIsFinal),
      source: "api-football-fixture-sum",
      source_updated_at: updatedAt,
      updated_at: updatedAt,
      fantasy_points: sum(playerStats, "fantasy_points"),
      score_ledger: combinedLedger(playerStats),
      calculator_version: "fixture-sum-v1",
    };
  });
}
