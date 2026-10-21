import {afterEach,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
const allowed=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/developer-auth',()=>({isDeveloperRequest:allowed}));
import {GET} from './route';
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs()});
it('requires developer authentication before reading health',async()=>{
 allowed.mockResolvedValue(false);
 expect((await GET(new NextRequest('https://test/api/developer/scoring-health'))).status).toBe(403);
});
it('returns durable checked-at and stale status without changing state',async()=>{
 allowed.mockResolvedValue(true);vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','test');
 const data={checkedAt:'2026-10-21T18:00:00Z',watchdogStale:false,diagnostics:{pendingWeeks:1}};
 const fetch=vi.fn(async()=>Response.json(data));vi.stubGlobal('fetch',fetch);
 const response=await GET(new NextRequest('https://test/api/developer/scoring-health'));
 expect(await response.json()).toEqual(data);expect(fetch).toHaveBeenCalledTimes(1);
 expect(response.headers.get('Cache-Control')).toBe('private, no-store');
});
