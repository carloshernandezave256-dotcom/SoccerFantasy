import {beforeEach,expect,it,vi} from 'vitest';
import type {LiveScoreStore} from './live-score-store';
const {sportmonks,db,refresh,profileMap}=vi.hoisted(()=>({sportmonks:vi.fn(),db:{from:vi.fn()},refresh:vi.fn(),profileMap:vi.fn()}));
vi.mock('./sportmonks-server',()=>({sportmonks}));
vi.mock('./sportmonks-data',async importOriginal=>({...await importOriginal<typeof import('./sportmonks-data')>(),adminDb:()=>db,profileMap}));
vi.mock('./live-score-leagues',()=>({refreshAffectedLeagueScores:refresh}));
import {synchronizeFixtureScores} from './live-score-sync';
const candidates=[{fixture_id:10,status:'FT',kickoff:'2026-08-23T18:00:00Z'}];
const now=new Date('2026-08-23T21:00:00Z');
beforeEach(()=>{
 vi.clearAllMocks();
 const context={...candidates[0],sportmonks_id:100};
 db.from.mockImplementation(table=>table==='sportmonks_teams'?{select:()=>Promise.resolve({data:[],error:null})}:{select:()=>({in:()=>Promise.resolve({data:[context],error:null})})});
 refresh.mockResolvedValue({leagueGameweeksUpdated:0,leagueRowsUpdated:0});
});
it('a failed SportMonks request withdraws final proof and reports the failure',async()=>{
 const store={renewSync:vi.fn(),priorProviderStatuses:vi.fn(async()=>new Map()),recordFixtureEvidence:vi.fn()};
 sportmonks.mockRejectedValue(Error('provider offline'));
 const result=await synchronizeFixtureScores(store as unknown as LiveScoreStore,candidates,now);
 expect(result.ok).toBe(false);expect(result.errors).toEqual([{fixtureId:10,error:'provider offline'}]);
 expect(store.recordFixtureEvidence).toHaveBeenLastCalledWith(10,now.toISOString(),false,'provider offline',[]);
 expect(refresh).toHaveBeenCalled();
});
it('does not write stats or certify a fixture when the provider returns another identity',async()=>{
 const store={renewSync:vi.fn(),priorProviderStatuses:vi.fn(async()=>new Map()),recordFixtureEvidence:vi.fn(),upsertFixtureStats:vi.fn()};
 sportmonks.mockResolvedValue({data:{id:999}});
 const result=await synchronizeFixtureScores(store as unknown as LiveScoreStore,candidates,now);
 expect(result.ok).toBe(false);expect(store.upsertFixtureStats).not.toHaveBeenCalled();
});
it('losing the synchronization lease stops ingestion before a provider request',async()=>{
 const store={renewSync:vi.fn(async()=>{throw Error('lease lost')}),priorProviderStatuses:vi.fn(async()=>new Map())};
 await expect(synchronizeFixtureScores(store as unknown as LiveScoreStore,candidates,now)).rejects.toThrow('lease lost');
 expect(sportmonks).not.toHaveBeenCalled();
});
