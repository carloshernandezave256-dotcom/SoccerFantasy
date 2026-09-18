import {afterEach,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
const allowed=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/developer-auth',()=>({isDeveloperRequest:allowed}));
import {GET} from './route';
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs()});
it('requires developer authentication',async()=>{
 allowed.mockResolvedValue(false);
 expect((await GET(new NextRequest('https://test/api/developer/gameweek-status'))).status).toBe(403);
});
it('validates league and week before querying',async()=>{
 allowed.mockResolvedValue(true);
 expect((await GET(new NextRequest('https://test/api/developer/gameweek-status?leagueId=bad&gameweek=4'))).status).toBe(400);
});
it('returns read-only pending evidence and stuck-attempt details',async()=>{
 allowed.mockResolvedValue(true);vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','test');
 const diagnostics={state:'pending',fixtures:[{fixtureId:1,reason:'Provider refresh in progress',staleAttempt:true,missingPlayerIds:[663]}]};
 const fetch=vi.fn(async()=>Response.json(diagnostics));vi.stubGlobal('fetch',fetch);
 const response=await GET(new NextRequest('https://test/api/developer/gameweek-status?leagueId=10000000-0000-0000-0000-000000000001&gameweek=4'));
 expect(await response.json()).toEqual(diagnostics);
 expect(fetch.mock.calls).toHaveLength(1);
});
