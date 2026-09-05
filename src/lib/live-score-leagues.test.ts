import {expect,it,vi} from 'vitest';
import {refreshAffectedLeagueScores} from './live-score-leagues';
import type {LiveScoreStore} from './live-score-store';
function mockStore(){return {
 affectedLeagueIds:async()=>['league-1'],
 leagueContext:async()=>({league:{calendar_competition:'La Liga',player_pool:'La Liga'},window:{gameweek:1,roster_lock_at:'2026-08-23T00:00:00Z'}}),
 gameweekFinalized:vi.fn(async()=>false),
 scoringWeekFixtures:vi.fn(async()=>[{fixture_id:10,status:'FT',kickoff:'2026-08-23T18:00:00Z',competition:'La Liga',gameweek:1,data_complete:false}]),
 fixtureStats:vi.fn(async()=>[]),lineupPlayerIds:async()=>[100],poolPlayerIds:async()=>[100,101],
 publishLeagueScores:vi.fn(async()=>2),
};}
const now=new Date('2026-08-23T21:00:00Z');
it('uses one atomic publication for the authoritative week',async()=>{
 const store=mockStore();expect(await refreshAffectedLeagueScores(store as unknown as LiveScoreStore,[10],now)).toEqual({leagueRowsUpdated:2,leagueGameweeksUpdated:1});
 expect(store.publishLeagueScores).toHaveBeenCalledTimes(1);
 expect(store.publishLeagueScores.mock.calls[0]).toBeDefined();
});
it('a catch-up match outside the frozen set cannot write or settle current matchups',async()=>{
 const store=mockStore();await refreshAffectedLeagueScores(store as unknown as LiveScoreStore,[99],now);
 expect(store.fixtureStats).not.toHaveBeenCalled();expect(store.publishLeagueScores).not.toHaveBeenCalled();
});
it('never publishes provider corrections into a finalized week',async()=>{
 const store=mockStore();store.gameweekFinalized.mockResolvedValue(true);
 await refreshAffectedLeagueScores(store as unknown as LiveScoreStore,[10],now);
 expect(store.scoringWeekFixtures).not.toHaveBeenCalled();expect(store.publishLeagueScores).not.toHaveBeenCalled();
});

it('only the explicit scheduler path can settle an all-excluded week',async()=>{
 const store=mockStore();store.scoringWeekFixtures.mockResolvedValue([{fixture_id:10,status:'EXCLUDED',kickoff:'2026-08-23T18:00:00Z',competition:'La Liga',gameweek:1,data_complete:true}]);
 await refreshAffectedLeagueScores(store as unknown as LiveScoreStore,[10],now);
 expect(store.publishLeagueScores).not.toHaveBeenCalled();
 await refreshAffectedLeagueScores(store as unknown as LiveScoreStore,[],now,['league-1']);
 expect(store.fixtureStats).not.toHaveBeenCalled();expect(store.publishLeagueScores).toHaveBeenCalledTimes(1);
});
