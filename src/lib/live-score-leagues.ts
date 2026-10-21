import { buildLeaguePlayerScoreRows } from "./live-score-domain";
import { LiveScoreStore } from "./live-score-store";

export type LeagueRefreshSummary = {
  leagueRowsUpdated: number;
  leagueGameweeksUpdated: number;
  errors: Array<{leagueId:string;gameweek?:number;error:string}>;
};

/** Publish each affected week once. Explicit retries are independent of provider fetches. */
export async function refreshAffectedLeagueScores(
  store: LiveScoreStore,
  fixtureIds: number[],
  now: Date,
  retryLeagueIds: string[] = [],
): Promise<LeagueRefreshSummary> {
  const affected=fixtureIds.length?await store.affectedLeagueIds(fixtureIds):[];
  const leagueIds=[...new Set([...affected,...retryLeagueIds])];
  const summary:LeagueRefreshSummary={leagueRowsUpdated:0,leagueGameweeksUpdated:0,errors:[]};
  for (const leagueId of leagueIds) {
    try {
      for (const { league, window } of await store.scoringLeagueContexts(leagueId)) {
        if (!league || !window || new Date(window.roster_lock_at) > now) continue;
        try {
          if(await store.gameweekFinalized(leagueId,window.gameweek))continue;
          const weekFixtures=await store.scoringWeekFixtures(leagueId,window.gameweek);
          // Empty membership or incomplete evidence is not permission to synthesize DNPs.
          const ready=weekFixtures.length>0&&weekFixtures.every(f=>f.data_complete===true
            &&(f.status==='EXCLUDED'||['FT','AET','PEN'].includes(f.status)));
          const touched=weekFixtures.some(f=>f.status!=='EXCLUDED'&&fixtureIds.includes(f.fixture_id));
          if(!touched&&!(retryLeagueIds.includes(leagueId)&&ready))continue;
          const ids=weekFixtures.filter(f=>f.status!=='EXCLUDED').map(f=>f.fixture_id);
          const [fixtureStats,lineupPlayerIds,poolPlayerIds]=await Promise.all([
            ids.length?store.fixtureStats(ids):Promise.resolve([]),
            store.lineupPlayerIds(leagueId,window.gameweek),store.poolPlayerIds(league.player_pool),
          ]);
          const playerIds=[...new Set([...poolPlayerIds,...lineupPlayerIds,...fixtureStats.map(s=>s.player_id)])];
          const rows=buildLeaguePlayerScoreRows({leagueId,gameweek:window.gameweek,playerIds,
            fixtureStats,weekFixtures,updatedAt:now.toISOString()});
          if(!rows.length)throw new Error('No score rows available for the locked fantasy week.');
          const published=await store.publishLeagueScores(leagueId,window.gameweek,rows,weekFixtures);
          summary.leagueRowsUpdated+=published;
          if(published>0)summary.leagueGameweeksUpdated++;
        } catch(error) {
          summary.errors.push({leagueId,gameweek:window.gameweek,error:error instanceof Error?error.message:String(error)});
        }
      }
    } catch(error) {
      summary.errors.push({leagueId,error:error instanceof Error?error.message:String(error)});
    }
  }
  return summary;
}
