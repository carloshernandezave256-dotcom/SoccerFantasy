import {beforeEach,expect,it,vi} from 'vitest';
import type {LiveScoreStore} from './live-score-store';
const {fetchProviderSnapshot}=vi.hoisted(()=>({fetchProviderSnapshot:vi.fn()}));
vi.mock('./live-score-provider',()=>({fetchProviderSnapshot,fetchProviderOwnGoals:vi.fn(),fetchProviderLineups:vi.fn()}));
import {synchronizeFixtureScores} from './live-score-sync';
beforeEach(()=>{fetchProviderSnapshot.mockReset()});
const candidates=[{fixture_id:10,status:'FT',kickoff:'2026-08-23T18:00:00Z'}];
const now=new Date('2026-08-23T21:00:00Z');
it('withdraws prior completeness before a missing provider fixture response',async()=>{
 const recordFixtureEvidence=vi.fn(async()=>{});
 fetchProviderSnapshot.mockImplementation(async()=>{
  expect(recordFixtureEvidence).toHaveBeenCalledWith(10,now.toISOString(),false,expect.any(String),[]);
  return {fixtures:[],requestsUsed:1};
 });
 await synchronizeFixtureScores({recordFixtureEvidence} as unknown as LiveScoreStore,candidates,now);
 expect(recordFixtureEvidence).toHaveBeenCalledTimes(1);
});
it('a failed provider request leaves completeness pending instead of trusting old data',async()=>{
 const recordFixtureEvidence=vi.fn(async()=>{});
 fetchProviderSnapshot.mockRejectedValue(Error('provider offline'));
 await expect(synchronizeFixtureScores({recordFixtureEvidence} as unknown as LiveScoreStore,candidates,now)).rejects.toThrow('provider offline');
 expect(recordFixtureEvidence).toHaveBeenCalledTimes(1);
 expect(recordFixtureEvidence).toHaveBeenCalledWith(10,now.toISOString(),false,expect.any(String),[]);
});
