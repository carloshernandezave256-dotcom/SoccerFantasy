import {afterEach,expect,it,vi} from 'vitest';
import {sportmonks} from './sportmonks-server';
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs()});
it('keeps credentials in headers and strips provider metadata',async()=>{
 vi.stubEnv('SPORTMONKS_API_TOKEN','test-secret');
 const fetcher=vi.fn(async()=>new Response(JSON.stringify({data:[{id:8}],subscription:{private:true}})));
 vi.stubGlobal('fetch',fetcher);
 expect(await sportmonks('leagues')).toEqual({data:[{id:8}],pagination:null});
 const [url,options]=fetcher.mock.calls[0] as unknown as [URL,RequestInit];
 expect(url.toString()).not.toContain('test-secret');
 expect(options.headers).toMatchObject({Authorization:'test-secret'});
});
it('does not expose provider error bodies or accept malformed responses',async()=>{
 vi.stubEnv('SPORTMONKS_API_TOKEN','test-secret');
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('private detail',{status:403})));
 await expect(sportmonks('leagues')).rejects.toThrow('SportMonks returned HTTP 403.');
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('{}')));
 await expect(sportmonks('leagues')).rejects.toThrow('data payload');
});
