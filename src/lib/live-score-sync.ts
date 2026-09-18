import {normalizeProviderPlayerPages,providerPlayerIds,reconcileFixtureStatus,type CachedFixture} from './live-score-domain';
import {refreshAffectedLeagueScores} from './live-score-leagues';
import {fetchProviderOwnGoals,fetchProviderSnapshot,fetchProviderLineups} from './live-score-provider';
import {fixtureCompleteness} from './fixture-completeness';
import {LiveScoreStore} from './live-score-store';
const COMPLETED_MATCH_STATUSES=new Set(['FT','AET','PEN']);

/** Shared manual/cron ingestion and per-fixture scoring. Never selects a week from a match's round. */
export async function synchronizeFixtureScores(store:LiveScoreStore,candidates:CachedFixture[],now:Date){
  const ranAt=now.toISOString();
  await Promise.all(candidates.map(f=>store.recordFixtureEvidence(f.fixture_id,ranAt,false,'Provider refresh in progress',[])));
  const snapshot = await fetchProviderSnapshot(candidates);
  if (!snapshot.fixtures.length) {
    return {
      ok: true,
      ranAt,
      requestsUsed: snapshot.requestsUsed,
      fixturesEligible: candidates.length,
      fixturesLive: 0,
      reason: "Cached fixtures were near kickoff, but none was available from the provider.",
    };
  }

  const fixtureIds = snapshot.fixtures.map((fixture) => fixture.fixture.id);
  const priorStatuses = await store.priorProviderStatuses(fixtureIds, now);
  const cachedStatuses = new Map(
    candidates.map((fixture) => [fixture.fixture_id, fixture.status]),
  );
  const reconciledStatuses = new Map(
    snapshot.fixtures.map((fixture) => [
      fixture.fixture.id,
      reconcileFixtureStatus(
        fixture.fixture.status.short,
        cachedStatuses.get(fixture.fixture.id),
        priorStatuses.get(fixture.fixture.id),
      ),
    ]),
  );
  await Promise.all(
    snapshot.fixtures.map((fixture) => store.updateFixtureState(
      fixture,
      reconciledStatuses.get(fixture.fixture.id) ?? fixture.fixture.status.short,
      ranAt,
    )),
  );

  // Re-fetch final events on reconciliation so own-goal corrections use the
  // same observation as player stats. Live responses retain prior own goals.
  const eventFixtureIds = snapshot.fixtures.flatMap((fixture) => {
    const fixtureId = fixture.fixture.id;
    return COMPLETED_MATCH_STATUSES.has(reconciledStatuses.get(fixtureId) ?? "")
      ? [fixtureId]
      : [];
  });
  const [ownGoalSnapshot,lineups]=await Promise.all([
    fetchProviderOwnGoals(eventFixtureIds),fetchProviderLineups(eventFixtureIds),
  ]);

  const apiIds = providerPlayerIds(snapshot.playerPages);
  const mappings = await store.playerMappings(apiIds);
  const internalPlayerIdByApiId = new Map(
    mappings.flatMap((player) =>
      player.api_football_id === null ? [] : [[player.api_football_id, player.id] as const],
    ),
  );
  const normalized = normalizeProviderPlayerPages(
    snapshot.playerPages,
    internalPlayerIdByApiId,
    ranAt,
    ownGoalSnapshot.byFixtureAndApiPlayer,
  );

  await store.insertObservations(normalized.observations);
  await store.upsertFixtureStats(normalized.rows, ranAt);
  const clubsUpdated = await store.reconcilePlayerClubs(normalized.clubAppearances);
  await store.markFixtureEventsSynced(ownGoalSnapshot.fixtureIdsSynced, ranAt);
  const kickoffByFixtureId = new Map(
    snapshot.fixtures.map((fixture) => [fixture.fixture.id, fixture.fixture.date]),
  );
  const injuriesCleared = await store.reconcilePlayerAvailability(
    normalized.rows.flatMap((row) => {
      const kickoff = kickoffByFixtureId.get(row.fixture_id);
      return Number(row.minutes) > 0 && kickoff
        ? [{ player_id: row.player_id, kickoff }]
        : [];
    }),
  );
  if (!normalized.rows.length) {
    console.warn("[cron/scores] provider returned no mapped player statistics", {
      fixtureIds,
      providerPlayers: apiIds.length,
    });
  }

  for(const page of snapshot.playerPages){
    const proof=fixtureCompleteness(page,lineups.get(page.fixture.fixture.id)??[],internalPlayerIdByApiId);
    await store.recordFixtureEvidence(page.fixture.fixture.id,ranAt,
      proof.complete&&COMPLETED_MATCH_STATUSES.has(reconciledStatuses.get(page.fixture.fixture.id)??''),
      proof.reason,normalized.rows.filter(row=>row.fixture_id===page.fixture.fixture.id).map(row=>row.player_id));
  }
  const leagueSummary = await refreshAffectedLeagueScores(store, fixtureIds, now);
  const unmappedPlayers = normalized.observations.reduce(
    (total, observation) => total + observation.unmapped_players.length,
    0,
  );
  console.info("[cron/scores] pipeline completed", {
    fixtureIds,
    liveFixtures: snapshot.liveFixtures.length,
    recoveredFixtures: snapshot.recoveredFixtures.length,
    providerPlayers: apiIds.length,
    mappedPlayers: normalized.rows.length,
    unmappedPlayers,
    injuriesCleared,
    clubsUpdated,
    eventFixturesSynced: ownGoalSnapshot.fixtureIdsSynced.length,
    ...leagueSummary,
  });

  return {
    ok: true,
    ranAt,
    requestsUsed: snapshot.requestsUsed + ownGoalSnapshot.requestsUsed + eventFixtureIds.length,
    fixturesEligible: candidates.length,
    fixturesLive: snapshot.fixtures.length,
    sharedPlayerRowsUpdated: normalized.rows.length,
    fantasyLeagueGameweeksUpdated: leagueSummary.leagueGameweeksUpdated,
    leaguePlayerRowsUpdated: leagueSummary.leagueRowsUpdated,
    injuriesCleared,
    clubsUpdated,
    eventFixturesSynced: ownGoalSnapshot.fixtureIdsSynced.length,
  };

}
