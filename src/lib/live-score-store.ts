import { fetchAllRestRows } from "./supabase-rest";
import type {
  CachedFixture,
  FixtureObservation,
  FixturePlayerStatRow,
  LeaguePlayerScoreRow,
  PlayerClubAppearance,
  ProviderFixture,
  WeekFixture,
} from "./live-score-domain";

export type PlayerMapping = { id: number; api_football_id: number | null };
export type LeagueFixture = { league_id: string; fixture_id: number };
export type LeagueConfig = { calendar_competition: string; player_pool: string };
export type TransactionWindow = { gameweek: number; roster_lock_at: string };
export type PlayerAppearance = { player_id: number; kickoff: string };
export type FixtureClubContext = { fixture_id: number; kickoff: string; competition: string };

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

  async excludedScoringLeagueIds(){
    const response=await this.write('rpc/excluded_scoring_leagues','POST',{},'Could not read excluded weeks.','return=representation');
    return (await response.json() as Array<{league_id:string}>).map(row=>row.league_id);
  }

  async recordFixtureEvidence(fixtureId:number,observedAt:string,complete:boolean,reason:string,playerIds:number[]){
    await this.write('rpc/record_fixture_stat_evidence','POST',{
      p_fixture_id:fixtureId,p_observed_at:observedAt,p_complete:complete,p_reason:reason,p_player_ids:playerIds,
    },'Could not record fixture completeness.');
  }

  async scoringWeekFixtures(leagueId:string,gameweek:number):Promise<WeekFixture[]>{
    const response=await this.write('rpc/scoring_week_fixtures','POST',{
      p_league_id:leagueId,p_gameweek:gameweek,
    },'Could not read authoritative week fixtures.','return=representation');
    return response.json();
  }

  async gameweekFinalized(leagueId:string,gameweek:number){
    const rows=await this.read<Array<{gameweek:number}>>(
      `finalized_gameweek_locks?league_id=eq.${leagueId}&gameweek=eq.${gameweek}&select=gameweek`,
      'Could not check finalization.');
    return rows.length>0;
  }

  async publishLeagueScores(leagueId:string,gameweek:number,rows:LeaguePlayerScoreRow[],fixtures:WeekFixture[]){
    const response=await this.write('rpc/publish_gameweek_scores','POST',{
      p_league_id:leagueId,p_gameweek:gameweek,p_rows:rows,
      p_evidence:fixtures.map(f=>({fixture_id:f.fixture_id,status:f.status,evidence_version:f.evidence_version??null})),
    },'Could not publish reconciled week scores.','return=representation');
    return Number(await response.json());
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
          select: "fixture_id,status,kickoff,events_synced_at",
          fixture_id: `eq.${forcedFixtureId}`,
        })
      : new URLSearchParams({
          select: "fixture_id,status,kickoff,events_synced_at",
          and: `(kickoff.gte.${windowStart},kickoff.lte.${now.toISOString()})`,
        });
    const recent=await this.read<CachedFixture[]>(
      `football_fixture_cache?${query}`,
      "Could not read the fixture cache.",
    );
    if(forcedFixtureId)return recent;
    const response=await this.write('rpc/pending_scoring_fixtures','POST',{},'Could not read pending reconciliation fixtures.','return=representation');
    const pending=await response.json() as CachedFixture[];
    return [...new Map([...recent,...pending].map(f=>[f.fixture_id,f])).values()];
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
    const response = await this.write(
      "rpc/resolve_api_football_player_mappings",
      "POST",
      { p_api_ids: apiIds },
      "Could not map provider players.",
      "return=representation",
    );
    return response.json() as Promise<PlayerMapping[]>;
  }

  async fixtureClubContexts(fixtureIds: number[]): Promise<FixtureClubContext[]> {
    if (!fixtureIds.length) return [];
    return this.read<FixtureClubContext[]>(
      `football_fixture_cache?fixture_id=in.(${fixtureIds.join(",")})&select=fixture_id,kickoff,competition`,
      "Could not read fixture club contexts.",
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
    const rowsWithOwnGoals = rows.filter((row) => Object.hasOwn(row, "own_goals"));
    const rowsWithoutOwnGoals = rows.filter((row) => !Object.hasOwn(row, "own_goals"));
    for (const group of [rowsWithOwnGoals, rowsWithoutOwnGoals]) {
      if (!group.length) continue;
      await this.write(
        "football_fixture_player_stats?on_conflict=fixture_id,player_id",
        "POST",
        group,
        "Shared player-stat cache update failed.",
        "resolution=merge-duplicates,return=minimal",
      );
    }
    const fixtureIds = [...new Set(rows.map((row) => row.fixture_id))];
    await this.write(
      `football_fixture_cache?fixture_id=in.(${fixtureIds.join(",")})`,
      "PATCH",
      { stats_synced_at: syncedAt },
      "Could not mark fixture statistics as synchronized.",
    );
  }

  async markFixtureEventsSynced(fixtureIds: number[], syncedAt: string) {
    if (!fixtureIds.length) return;
    await this.write(
      `football_fixture_cache?fixture_id=in.(${fixtureIds.join(",")})`,
      "PATCH",
      { events_synced_at: syncedAt },
      "Could not mark fixture events as synchronized.",
    );
  }

  async reconcilePlayerAvailability(appearances: PlayerAppearance[]) {
    if (!appearances.length) return 0;
    const response = await this.write(
      "rpc/reconcile_player_availability_from_appearances",
      "POST",
      { p_appearances: appearances },
      "Could not reconcile player availability from appearance data.",
      "return=representation",
    );
    return Number(await response.json()) || 0;
  }

  async reconcilePlayerClubs(appearances: PlayerClubAppearance[]) {
    if (!appearances.length) return 0;
    const response = await this.write(
      "rpc/reconcile_player_clubs_from_appearances",
      "POST",
      { p_appearances: appearances },
      "Could not reconcile player clubs from fixture appearances.",
      "return=representation",
    );
    return Number(await response.json()) || 0;
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

  async fixtureStats(fixtureIds: number[]) {
    return fetchAllRestRows<FixturePlayerStatRow>(
      `${this.baseUrl}/rest/v1/football_fixture_player_stats?fixture_id=in.(${fixtureIds.join(",")})&select=*`,
      this.headers(),
    );
  }

  async lineupPlayerIds(leagueId: string,gameweek?:number) {
    const rows = await this.read<Array<{ player_id: number }>>(
      `lineup_players?league_id=eq.${leagueId}&select=player_id`,
      `Could not read lineup players for ${leagueId}.`,
    );
    const snapshots=gameweek===undefined?[]:await this.read<Array<{player_id:number}>>(
      `lineup_gameweek_players?league_id=eq.${leagueId}&gameweek=eq.${gameweek}&select=player_id`,
      'Could not read locked lineup players.');
    return [...new Set([...rows,...snapshots].map(row=>row.player_id))];
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

}
