import {beforeEach,expect,it,vi} from 'vitest';
import type {LiveScoreStore} from './live-score-store';
const {sportmonks,db,refresh,profileMap}=vi.hoisted(()=>({sportmonks:vi.fn(),db:{from:vi.fn()},refresh:vi.fn(),profileMap:vi.fn()}));
vi.mock('./sportmonks-server',()=>({sportmonks}));
vi.mock('./sportmonks-data',async importOriginal=>({...await importOriginal<typeof import('./sportmonks-data')>(),adminDb:()=>db,profileMap}));
vi.mock('./live-score-leagues',()=>({refreshAffectedLeagueScores:refresh}));
import {synchronizeFixtureScores} from './live-score-sync';
import {reviewedDovbyk, dovbykContext} from './test-fixtures/sportmonks';
const candidates=[{fixture_id:10,status:'FT',kickoff:'2026-08-23T18:00:00Z'}];
const now=new Date('2026-08-23T21:00:00Z');
beforeEach(()=>{
 vi.clearAllMocks();
 const context={...candidates[0],sportmonks_id:100};
 db.from.mockImplementation(table=>table==='sportmonks_teams'?{select:()=>Promise.resolve({data:[],error:null})}:{select:()=>({in:()=>Promise.resolve({data:[context],error:null})})});
 refresh.mockResolvedValue({leagueGameweeksUpdated:0,leagueRowsUpdated:0,errors:[]});
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

it.each([true, false])('persists exact reviewed provenance only when the overlay was used (%s)', async supplemented => {
 const source = reviewedDovbyk();
 if (!supplemented) {
  source.raw_data.lineups.find(lineup => lineup.player_id === 205978)!.details!.push(
   {type_id: 80, data: {value: 20}}, {type_id: 116, data: {value: 14}}, {type_id: 120, data: {value: 25}},
  );
 }
 const before = JSON.stringify(source.raw_data);
 const fixture = {
  ...dovbykContext, sportmonks_id: source.sportmonks_id, status: 'FT',
  home_team: 'Bologna', away_team: 'Inter', competition: 'Serie A',
 };
 const upsert = vi.fn(async () => ({data: null, error: null}));
 const updated = vi.fn(async () => ({data: null, error: null}));
 db.from.mockImplementation(table => {
  if (table === 'sportmonks_teams') return {select: async () => ({data: [
   {sportmonks_id: 8513, club: 'Bologna', competition: 'Serie A'},
   {sportmonks_id: 2930, club: 'Inter', competition: 'Serie A'},
  ], error: null})};
  if (table === 'football_fixture_cache') return {select: () => ({in: async () => ({data: [fixture], error: null})})};
  if (table === 'sportmonks_fixture_sources') return {upsert, update: () => ({eq: updated})};
  throw new Error(`Unexpected database table ${table}`);
 });
 profileMap.mockResolvedValue(source.player_map);
 sportmonks.mockResolvedValue({data: source.raw_data});
 const store = {
  renewSync: vi.fn(), priorProviderStatuses: vi.fn(async () => new Map()),
  updateFixtureState: vi.fn(), recordFixtureEvidence: vi.fn(), upsertFixtureStats: vi.fn(),
  markFixtureEventsSynced: vi.fn(), insertObservations: vi.fn(),
  reconcilePlayerAvailability: vi.fn(async () => 0), reconcilePlayerClubs: vi.fn(async () => 0),
 };
 const observed = new Date('2026-10-21T18:39:02Z');
 const result = await synchronizeFixtureScores(store as unknown as LiveScoreStore, [fixture], observed, {publish: false});
 expect(result.ok).toBe(true);
 const note = supplemented
  ? 'SportMonks lineup, minutes and events reconciled; Reviewed supplement: FotMob match 5749702, player 655696 (https://www.fotmob.com/match/5749702); omitted passes/accurate passes/touches only (SportMonks 80/116/120)'
  : 'SportMonks lineup, minutes and events reconciled';
 expect(store.recordFixtureEvidence).toHaveBeenLastCalledWith(
  1550149, observed.toISOString(), true, note, expect.arrayContaining([2178]),
 );
 expect(JSON.stringify(source.raw_data)).toBe(before);
 expect(upsert).toHaveBeenCalledTimes(2);
 expect(upsert).toHaveBeenLastCalledWith(expect.objectContaining({raw_data: source.raw_data}), {onConflict: 'fixture_id'});
 expect(updated).toHaveBeenCalledWith('fixture_id', 1550149);
});
