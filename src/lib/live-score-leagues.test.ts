import { describe, expect, it } from "vitest";
import { refreshAffectedLeagueScores } from "./live-score-leagues";
import type { LiveScoreStore } from "./live-score-store";

describe("refreshAffectedLeagueScores", () => {
  it("preserves weekend points across repeated refreshes and accepts corrected statistics", async () => {
    const madrid={fixture_id:1570379,status:"FT",kickoff:"2026-09-12T19:00:00Z",competition:"La Liga",gameweek:5};
    const barca={fixture_id:1570376,status:"FT",kickoff:"2026-09-13T14:15:00Z",competition:"La Liga",gameweek:5};
    const future=Array.from({length:10},(_,i)=>({fixture_id:200+i,status:"NS",kickoff:"2026-09-16T19:00:00Z",competition:"La Liga",gameweek:6}));
    let konatePoints=5;
    const updates:Array<Array<{player_id:number;fantasy_points:number}>>=[];
    const store={
      affectedLeagueIds:async()=>["league-1"],
      leagueContext:async()=>({league:{calendar_competition:"Premier League",player_pool:"All Top Five"},window:{gameweek:4,roster_lock_at:"2026-09-12T14:00:00Z"}}),
      calendarFixtures:async()=>[{kickoff:"2026-09-12T14:00:00Z"}],
      weekFixtures:async()=>[madrid,barca,...future],
      fixtureStats:async(ids:number[])=>{
        expect(ids).toEqual([1570379,1570376]);
        return [{fixture_id:1570379,player_id:402,minutes:90,fantasy_points:konatePoints,score_ledger:[]},{fixture_id:1570376,player_id:5,minutes:66,fantasy_points:10,score_ledger:[]}];
      },
      lineupPlayerIds:async()=>[402,5],poolPlayerIds:async()=>[402,5],
      upsertLeagueScores:async(rows:Array<{player_id:number;fantasy_points:number}>)=>{updates.push(rows);},
      refreshMatchupScores:async()=>{},settleFinalGameweek:async()=>0,
    } as unknown as LiveScoreStore;
    await refreshAffectedLeagueScores(store,[1570376],new Date("2026-09-13T17:00:00Z"));
    await refreshAffectedLeagueScores(store,[1570376],new Date("2026-09-13T17:02:00Z"));
    expect(updates[0].map(r=>r.fantasy_points)).toEqual([5,10]);
    expect(updates[1].map(r=>r.fantasy_points)).toEqual([5,10]);
    konatePoints=6;
    await refreshAffectedLeagueScores(store,[1570379],new Date("2026-09-13T17:04:00Z"));
    expect(updates[2].map(r=>r.fantasy_points)).toEqual([6,10]);
  });
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
      poolPlayerIds: async () => [100, 101],
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
    expect(result).toEqual({ leagueRowsUpdated: 2, leagueGameweeksUpdated: 1 });
  });
});
