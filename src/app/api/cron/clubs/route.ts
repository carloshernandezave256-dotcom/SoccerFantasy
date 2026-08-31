import { NextRequest, NextResponse } from "next/server";
import { apiFootball } from "@/lib/api-football-server";
import type { PlayerClubAppearance, ProviderTeamPlayers } from "@/lib/live-score-domain";
import { LiveScoreStore } from "@/lib/live-score-store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type PlayerPage = { response: ProviderTeamPlayers[] };

function requestedFixtureIds(request: NextRequest) {
  const ids = (request.nextUrl.searchParams.get("fixtureIds") ?? "")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isSafeInteger(value) && value > 0);
  return [...new Set(ids)].slice(0, 50);
}

async function inBatches<T, R>(items: T[], size: number, task: (item: T) => Promise<R>) {
  const results: R[] = [];
  for (let start = 0; start < items.length; start += size) {
    results.push(...await Promise.all(items.slice(start, start + size).map(task)));
  }
  return results;
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const fixtureIds = requestedFixtureIds(request);
  if (!fixtureIds.length) {
    return NextResponse.json({ error: "Provide one to 50 fixtureIds." }, { status: 400 });
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

  try {
    const store = new LiveScoreStore(baseUrl, serviceRoleKey);
    const contexts = await store.fixtureClubContexts(fixtureIds);
    const contextById = new Map(contexts.map((context) => [context.fixture_id, context]));
    const pages = await inBatches(fixtureIds, 5, async (fixtureId) => ({
      fixtureId,
      body: await apiFootball<PlayerPage>(`fixtures/players?fixture=${fixtureId}`),
    }));
    const apiIds = [...new Set(pages.flatMap(({ body }) =>
      body.response.flatMap((team) => team.players.map((entry) => entry.player.id))
    ))];
    const mappings = await store.playerMappings(apiIds);
    const playerIdByApiId = new Map(
      mappings.flatMap((mapping) => mapping.api_football_id === null
        ? []
        : [[mapping.api_football_id, mapping.id] as const]),
    );
    const observedAt = new Date().toISOString();
    const appearances: PlayerClubAppearance[] = [];

    for (const { fixtureId, body } of pages) {
      const context = contextById.get(fixtureId);
      if (!context) continue;
      for (const team of body.response) {
        for (const entry of team.players) {
          const playerId = playerIdByApiId.get(entry.player.id);
          const minutes = entry.statistics[0]?.games.minutes ?? 0;
          if (!playerId || minutes <= 0) continue;
          appearances.push({
            fixture_id: fixtureId,
            player_id: playerId,
            club: team.team.name,
            competition: context.competition,
            kickoff: context.kickoff,
            observed_at: observedAt,
          });
        }
      }
    }

    const clubsUpdated = await store.reconcilePlayerClubs(appearances);
    return NextResponse.json({
      ok: true,
      fixturesRequested: fixtureIds.length,
      fixturesFound: contexts.length,
      requestsUsed: fixtureIds.length,
      appearancesConfirmed: appearances.length,
      clubsUpdated,
      unmappedProviderPlayers: apiIds.length - mappings.length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Club reconciliation failed." },
      { status: 502 },
    );
  }
}
