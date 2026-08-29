import { NextRequest, NextResponse } from "next/server";
import {
  normalizeProviderPlayerPages,
  providerPlayerIds,
  reconcileFixtureStatus,
} from "@/lib/live-score-domain";
import { refreshAffectedLeagueScores } from "@/lib/live-score-leagues";
import { fetchProviderOwnGoals, fetchProviderSnapshot } from "@/lib/live-score-provider";
import { LiveScoreStore } from "@/lib/live-score-store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
const COMPLETED_MATCH_STATUSES = new Set(["FT", "AET", "PEN"]);

function validForcedFixtureId(request: NextRequest) {
  const fixtureId = Number(request.nextUrl.searchParams.get("fixtureId") ?? 0);
  return Number.isSafeInteger(fixtureId) && fixtureId > 0 ? fixtureId : undefined;
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    ?? "https://ocabrgbrkqmsnalbfzvx.supabase.co";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    return NextResponse.json(
      { error: "Server database credential is not configured." },
      { status: 503 },
    );
  }

  const now = new Date();
  const ranAt = now.toISOString();
  const store = new LiveScoreStore(baseUrl, serviceRoleKey);

  try {
    // The overlap guard is shorter than the two-minute scheduler cadence.
    const claimed = await store.claimSync(now);
    if (!claimed) {
      return NextResponse.json({
        ok: true,
        ranAt,
        requestsUsed: 0,
        reason: "A shared live-score synchronization is already running.",
      });
    }

    // All cached Top-5 fixtures remain candidates for four hours after kickoff,
    // regardless of status. FT never stops the final-stat reconciliation early.
    const candidates = await store.candidateFixtures(now, validForcedFixtureId(request));
    if (!candidates.length) {
      return NextResponse.json({
        ok: true,
        ranAt,
        requestsUsed: 0,
        reason: "No cached fixture is inside a possible live-match window.",
      });
    }

    const snapshot = await fetchProviderSnapshot(candidates);
    if (!snapshot.fixtures.length) {
      return NextResponse.json({
        ok: true,
        ranAt,
        requestsUsed: snapshot.requestsUsed,
        fixturesEligible: candidates.length,
        fixturesLive: 0,
        reason: "Cached fixtures were near kickoff, but none was available from the provider.",
      });
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

    // Player-stat payloads do not include own goals. Fetch the event ledger once,
    // only after a fixture has been confirmed terminal, then cache that completion.
    const candidateById = new Map(candidates.map((fixture) => [fixture.fixture_id, fixture]));
    const eventFixtureIds = snapshot.fixtures.flatMap((fixture) => {
      const fixtureId = fixture.fixture.id;
      return COMPLETED_MATCH_STATUSES.has(reconciledStatuses.get(fixtureId) ?? "")
        && !candidateById.get(fixtureId)?.events_synced_at
        ? [fixtureId]
        : [];
    });
    const ownGoalSnapshot = await fetchProviderOwnGoals(eventFixtureIds);

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
      eventFixturesSynced: ownGoalSnapshot.fixtureIdsSynced.length,
      ...leagueSummary,
    });

    return NextResponse.json({
      ok: true,
      ranAt,
      requestsUsed: snapshot.requestsUsed + ownGoalSnapshot.requestsUsed,
      fixturesEligible: candidates.length,
      fixturesLive: snapshot.fixtures.length,
      sharedPlayerRowsUpdated: normalized.rows.length,
      fantasyLeagueGameweeksUpdated: leagueSummary.leagueGameweeksUpdated,
      leaguePlayerRowsUpdated: leagueSummary.leagueRowsUpdated,
      injuriesCleared,
      eventFixturesSynced: ownGoalSnapshot.fixtureIdsSynced.length,
    });
  } catch (error) {
    console.error("[cron/scores] pipeline failed", {
      ranAt,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Shared live score synchronization failed." },
      { status: 502 },
    );
  }
}
