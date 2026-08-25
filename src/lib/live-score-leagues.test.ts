import { describe, expect, it } from "vitest";
import { refreshAffectedLeagueScores } from "./live-score-leagues";
import type { LiveScoreStore } from "./live-score-store";

describe("refreshAffectedLeagueScores", () => {
  it("settles only after the final score rows and matchup totals are stored", async () => {
    const calls: string[] = [];
    const store = {
      affectedLeagueIds: async () => ["league-1"],
      leagueContext: async () => ({
        league: { calendar_competition: "La Liga", player_pool: "La Liga" },
        window: { gameweek: 1, roster_lock_at: "2026-08-23T00:00:00.000Z" },
      }),
      calendarFixtures: async () => [
        { fixture_id: 10, status: "FT", kickoff: "2026-08-23T18:00:00.000Z" },
      ],
      weekFixtures: async () => [
        { fixture_id: 10, status: "FT", kickoff: "2026-08-23T18:00:00.000Z" },
      ],
      fixtureStats: async () => [],
      lineupPlayerIds: async () => [100],
      upsertLeagueScores: async () => { calls.push("scores"); },
      refreshMatchupScores: async () => { calls.push("refresh"); },
      settleFinalGameweek: async () => { calls.push("settle"); return 1; },
    } as unknown as LiveScoreStore;

    const result = await refreshAffectedLeagueScores(
      store,
      [10],
      new Date("2026-08-23T21:00:00.000Z"),
    );

    expect(calls).toEqual(["scores", "refresh", "settle"]);
    expect(result).toEqual({ leagueRowsUpdated: 1, leagueGameweeksUpdated: 1 });
  });
});
