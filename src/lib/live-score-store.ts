import { fetchAllRestRows } from "./supabase-rest";
import type {
  CachedFixture,
  FixtureObservation,
  FixturePlayerStatRow,
  LeaguePlayerScoreRow,
  ProviderFixture,
  WeekFixture,
} from "./live-score-domain";

export type PlayerMapping = { id: number; api_football_id: number | null };
export type LeagueFixture = { league_id: string; fixture_id: number };
export type LeagueConfig = { calendar_competition: string; player_pool: string };
export type TransactionWindow = { gameweek: number; roster_lock_at: string };

const TOP_FIVE_COMPETITIONS = [
  "Premier League",
  "La Liga",
  "Serie A",
  "Bundesliga",
  "Ligue 1",
] as const;

export class LiveScoreStore {
  constructor(
    private readonly baseUrl: string,
    private readonly serviceRoleKey: string,
  ) {}

  private headers() {
    return {
      apikey: this.serviceRoleKey,
      Authorization: `Bearer ${this.serviceRoleKey}`,
      "Content-Type": "application/json",
    };
  }

  private async read<T>(path: string, errorMessage: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}/rest/v1/${path}`, {
      headers: this.headers(),
      cache: "no-store",
    });
    if (!response.ok) throw new Error((await response.text()) || errorMessage);
    return response.json() as Promise<T>;
  }

  private async write(
    path: string,
    method: "POST" | "PATCH",
    body: unknown,
    errorMessage: string,
    prefer = "return=minimal",
  ) {
    const response = await fetch(`${this.baseUrl}/rest/v1/${path}`, {
      method,
      headers: { ...this.headers(), Prefer: prefer },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (!response.ok) throw new Error((await response.text()) || errorMessage);
    return response;
  }

  async claimSync(now: Date) {
    const response = await this.write(
      `football_sync_state?singleton_id=eq.1&live_claimed_until=lt.${now.toISOString()}`,
      "PATCH",
      {
        live_claimed_until: new Date(now.getTime() + 105_000).toISOString(),
        updated_at: now.toISOString(),
      },
      "Could not claim the shared synchronization lock.",
      "return=representation",
    );
    const claimed = await response.json() as Array<{ singleton_id: number }>;
    return claimed.length > 0;
  }

  async candidateFixtures(now: Date, forcedFixtureId?: number): Promise<CachedFixture[]> {
    const windowStart = new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString();
    const query = forcedFixtureId
      ? new URLSearchParams({
          select: "fixture_id,status,kickoff",
          fixture_id: `eq.${forcedFixtureId}`,
        })
      : new URLSearchParams({
          select: "fixture_id,status,kickoff",
          and: `(kickoff.gte.${windowStart},kickoff.lte.${now.toISOString()})`,
        });
    return this.read<CachedFixture[]>(
      `football_fixture_cache?${query}`,
      "Could not read the fixture cache.",
    );
  }

  async priorProviderStatuses(fixtureIds: number[], now: Date) {
    const windowStart = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
    const rows = await this.read<Array<{ fixture_id: number; status: string }>>(
      `football_fixture_sync_observations?fixture_id=in.(${fixtureIds.join(",")})&observed_at=gte.${windowStart}&select=fixture_id,status,observed_at&order=observed_at.desc`,
      "Could not read prior fixture observations.",
    );
    const statuses = new Map<number, string>();
    for (const row of rows) if (!statuses.has(row.fixture_id)) statuses.set(row.fixture_id, row.status);
    return statuses;
  }

  async updateFixtureState(fixture: ProviderFixture, status: string, updatedAt: string) {
    const values = {
      status,
      kickoff: fixture.fixture.date,
      home_score: fixture.goals.home,
      away_score: fixture.goals.away,
      updated_at: updatedAt,
    };
    await Promise.all([
      this.write(
        `football_fixture_cache?fixture_id=eq.${fixture.fixture.id}`,
        "PATCH",
        values,
        `Could not update canonical fixture ${fixture.fixture.id}.`,
      ),
      this.write(
        `league_headline_fixtures?fixture_id=eq.${fixture.fixture.id}`,
        "PATCH",
        values,
        `Could not update league fixture copies for ${fixture.fixture.id}.`,
      ),
    ]);
  }

  async playerMappings(apiIds: number[]): Promise<PlayerMapping[]> {
    if (!apiIds.length) return [];
    return this.read<PlayerMapping[]>(
      `players?api_football_id=in.(${apiIds.join(",")})&select=id,api_football_id`,
      "Could not map provider players.",
    );
  }

  async insertObservations(observations: FixtureObservation[]) {
    if (!observations.length) return;
    await this.write(
      "football_fixture_sync_observations",
      "POST",
      observations,
      "Could not store fixture sync observations.",
    );
  }

  async upsertFixtureStats(rows: FixturePlayerStatRow[], syncedAt: string) {
    if (!rows.length) return;
    await this.write(
      "football_fixture_player_stats?on_conflict=fixture_id,player_id",
      "POST",
      rows,
      "Shared player-stat cache update failed.",
      "resolution=merge-duplicates,return=minimal",
    );
    const fixtureIds = [...new Set(rows.map((row) => row.fixture_id))];
    await this.write(
      `football_fixture_cache?fixture_id=in.(${fixtureIds.join(",")})`,
      "PATCH",
      { stats_synced_at: syncedAt },
      "Could not mark fixture statistics as synchronized.",
    );
  }

  async affectedLeagueIds(fixtureIds: number[]) {
    const rows = await this.read<LeagueFixture[]>(
      `league_headline_fixtures?fixture_id=in.(${fixtureIds.join(",")})&select=league_id,fixture_id`,
      "Could not find leagues affected by the fixture update.",
    );
    return [...new Set(rows.map((row) => row.league_id))];
  }

  async leagueContext(leagueId: string) {
    const [leagues, windows] = await Promise.all([
      this.read<LeagueConfig[]>(
        `leagues?id=eq.${leagueId}&select=calendar_competition,player_pool`,
        `Could not read league ${leagueId}.`,
      ),
      this.read<TransactionWindow[]>(
        `league_transaction_windows?league_id=eq.${leagueId}&select=gameweek,roster_lock_at&order=gameweek.desc&limit=1`,
        `Could not read the active transaction window for ${leagueId}.`,
      ),
    ]);
    return { league: leagues[0] ?? null, window: windows[0] ?? null };
  }

  async calendarFixtures(leagueId: string, competition: string, gameweek: number) {
    const query = new URLSearchParams({
      league_id: `eq.${leagueId}`,
      competition: `eq.${competition}`,
      gameweek: `eq.${gameweek}`,
      select: "fixture_id,status,kickoff",
      order: "kickoff.asc",
    });
    return this.read<WeekFixture[]>(
      `league_headline_fixtures?${query}`,
      `Could not read calendar fixtures for ${leagueId}.`,
    );
  }

  async weekFixtures(
    leagueId: string,
    playerPool: string,
    firstKickoff: string,
    lastKickoff: string,
  ) {
    const query = new URLSearchParams({
      league_id: `eq.${leagueId}`,
      and: `(kickoff.gte.${firstKickoff},kickoff.lte.${lastKickoff})`,
      select: "fixture_id,status,kickoff",
    });
    if (playerPool !== "All Top Five") query.set("competition", `eq.${playerPool}`);
    return this.read<WeekFixture[]>(
      `league_headline_fixtures?${query}`,
      `Could not read scoring fixtures for ${leagueId}.`,
    );
  }

  async fixtureStats(fixtureIds: number[]) {
    return fetchAllRestRows<FixturePlayerStatRow>(
      `${this.baseUrl}/rest/v1/football_fixture_player_stats?fixture_id=in.(${fixtureIds.join(",")})&select=*`,
      this.headers(),
    );
  }

  async lineupPlayerIds(leagueId: string) {
    const rows = await this.read<Array<{ player_id: number }>>(
      `lineup_players?league_id=eq.${leagueId}&select=player_id`,
      `Could not read lineup players for ${leagueId}.`,
    );
    return rows.map((row) => row.player_id);
  }

  async poolPlayerIds(playerPool: string) {
    const competitions = playerPool === "All Top Five"
      ? TOP_FIVE_COMPETITIONS
      : [playerPool];
    const query = new URLSearchParams({
      active: "eq.true",
      competition: `in.(${competitions.join(",")})`,
      select: "id",
    });
    const rows = await fetchAllRestRows<{ id: number }>(
      `${this.baseUrl}/rest/v1/players?${query}`,
      this.headers(),
    );
    return rows.map((row) => row.id);
  }

  async upsertLeagueScores(rows: LeaguePlayerScoreRow[]) {
    if (!rows.length) return;
    for (let start = 0; start < rows.length; start += 500) {
      await this.write(
        "league_player_scores?on_conflict=league_id,gameweek,player_id",
        "POST",
        rows.slice(start, start + 500),
        `League score update failed for ${rows[0].league_id}.`,
        "resolution=merge-duplicates,return=minimal",
      );
    }
  }

  async refreshMatchupScores(leagueId: string, gameweek: number) {
    await this.write(
      "rpc/refresh_league_matchup_scores",
      "POST",
      { p_league_id: leagueId, p_gameweek: gameweek },
      `Could not refresh matchup totals for ${leagueId}.`,
    );
  }

  async settleFinalGameweek(leagueId: string, gameweek: number) {
    const response = await this.write(
      "rpc/settle_final_gameweek",
      "POST",
      { p_league_id: leagueId, p_gameweek: gameweek },
      `Could not settle final gameweek ${gameweek} for ${leagueId}.`,
      "return=representation",
    );
    return Number(await response.json()) || 0;
  }
}
