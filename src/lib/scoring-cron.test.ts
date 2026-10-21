import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
const {store,sync,refresh}=vi.hoisted(()=>({store:{startScoringRun:vi.fn(),finishScoringRun:vi.fn(),claimSync:vi.fn(),renewSync:vi.fn(),releaseSync:vi.fn(),candidateFixtures:vi.fn(),pendingGameweeks:vi.fn()},sync:vi.fn(),refresh:vi.fn()}));
vi.mock('./live-score-store',()=>({LiveScoreStore:class{constructor(){return store;}}}));
vi.mock('./live-score-sync',()=>({synchronizeFixtureScores:sync}));
vi.mock('./live-score-leagues',()=>({refreshAffectedLeagueScores:refresh}));
import {scoringCron} from './scoring-cron';
const runId='10000000-0000-0000-0000-000000000001';
const req=(query='')=>new NextRequest(`https://test/api/cron/scores${query}`,{headers:{authorization:'Bearer test-secret'}});
beforeEach(()=>{
 vi.resetAllMocks();vi.stubEnv('CRON_SECRET','test-secret');vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','test-key');
 store.startScoringRun.mockResolvedValue(runId);store.claimSync.mockResolvedValue(true);
 store.candidateFixtures.mockResolvedValue([]);store.pendingGameweeks.mockResolvedValue([]);
 refresh.mockResolvedValue({leagueRowsUpdated:0,leagueGameweeksUpdated:0,errors:[]});
 sync.mockResolvedValue({ok:true,errors:[],requestsUsed:1,sharedPlayerRowsUpdated:22});
});
afterEach(()=>{vi.unstubAllEnvs()});
it('rejects unauthorized and malformed requests before journal or lease mutation',async()=>{
 expect((await scoringCron(new NextRequest('https://test/api/cron/scores'),'scores')).status).toBe(401);
 expect((await scoringCron(req('?fixtureId=bad'),'scores')).status).toBe(400);
 expect((await scoringCron(req('?runId=bad'),'scores')).status).toBe(400);
 expect(store.startScoringRun).not.toHaveBeenCalled();expect(store.claimSync).not.toHaveBeenCalled();
});
it('settles a ready week when no provider fixture is due and tracks actual completion',async()=>{
 const pending=[{league_id:'league',gameweek:7,fixtures_ready:true,diagnostics:{fixtures:[{status:'FT'}]}}];
 store.pendingGameweeks.mockResolvedValueOnce(pending).mockResolvedValue([]);
 const response=await scoringCron(req(`?runId=${runId}`),'scores');
 expect(response.status).toBe(200);expect(sync).not.toHaveBeenCalled();
 expect(refresh).toHaveBeenNthCalledWith(1,store,[],expect.any(Date),['league']);
 expect(store.startScoringRun).toHaveBeenCalledWith('scores',runId);
 expect(store.finishScoringRun).toHaveBeenCalledWith(runId,'completed',expect.objectContaining({ok:true}),undefined);
});
it.each(['scores','wrap-gameweeks'] as const)('returns a failing HTTP status for returned provider failures in %s',async job=>{
 store.candidateFixtures.mockResolvedValue([{fixture_id:10}]);
 sync.mockResolvedValue({ok:false,errors:[{fixtureId:10,error:'unresolved identity'}],requestsUsed:1});
 const response=await scoringCron(req(),job);
 expect(response.status).toBe(502);expect((await response.json()).ok).toBe(false);
 expect(store.finishScoringRun).toHaveBeenCalledWith(runId,'failed',expect.objectContaining({errors:[{fixtureId:10,error:'unresolved identity'}]}),undefined);
});
it('reports a blocked completed week even when the provider retry is throttled',async()=>{
 store.pendingGameweeks.mockResolvedValue([{league_id:'league',gameweek:7,fixtures_ready:false,diagnostics:{fixtures:[{status:'FT',complete:false}]}}]);
 const response=await scoringCron(req(),'scores');
 expect(response.status).toBe(502);expect((await response.json()).blockedGameweeks).toHaveLength(1);
});
it('keeps live weeks pending without reporting normal live play as failure',async()=>{
 store.pendingGameweeks.mockResolvedValue([{league_id:'league',gameweek:7,fixtures_ready:false,diagnostics:{fixtures:[{status:'1H'}]}}]);
 expect((await scoringCron(req(),'scores')).status).toBe(200);
});
it('marks overlap as skipped, never releasing another worker’s lease',async()=>{
 store.claimSync.mockResolvedValue(false);
 expect((await scoringCron(req(),'scores')).status).toBe(200);
 expect(store.releaseSync).not.toHaveBeenCalled();expect(store.pendingGameweeks).not.toHaveBeenCalled();
 expect(store.finishScoringRun).toHaveBeenCalledWith(runId,'skipped',expect.objectContaining({skipped:true}),undefined);
});
it('persists thrown publication/discovery errors and releases its own lease',async()=>{
 store.pendingGameweeks.mockRejectedValue(Error('database unavailable'));
 expect((await scoringCron(req(),'scores')).status).toBe(502);
 expect(store.releaseSync).toHaveBeenCalledTimes(1);
 expect(store.finishScoringRun).toHaveBeenCalledWith(runId,'failed',expect.objectContaining({error:'database unavailable'}),'database unavailable');
});
it('does not report success when the durable completion write fails',async()=>{
 store.finishScoringRun.mockRejectedValue(Error('tracking unavailable'));
 const response=await scoringCron(req(),'scores');
 expect(response.status).toBe(502);expect((await response.json()).trackingError).toBe('tracking unavailable');
});
