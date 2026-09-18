import { NextRequest, NextResponse } from "next/server";
import {refreshAffectedLeagueScores} from "@/lib/live-score-leagues";
import {synchronizeFixtureScores} from "@/lib/live-score-sync";
import { LiveScoreStore } from "@/lib/live-score-store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

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

    const excludedLeagueIds=await store.excludedScoringLeagueIds();
    const excludedSummary=await refreshAffectedLeagueScores(store,[],now,excludedLeagueIds);
    // All cached Top-5 fixtures remain candidates for four hours after kickoff,
    // regardless of status; bounded hourly retries also cover unresolved older fixtures.
    const candidates = await store.candidateFixtures(now, validForcedFixtureId(request));
    if (!candidates.length) {
      return NextResponse.json({
        ok: true,
        ranAt,
        requestsUsed: 0,
        reason: "No cached fixture is inside a possible live-match window.",
        excludedWeeksSettled:excludedSummary.leagueGameweeksUpdated,
      });
    }

    return NextResponse.json(await synchronizeFixtureScores(store,candidates,now));
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
