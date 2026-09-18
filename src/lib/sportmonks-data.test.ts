import {afterEach,expect,it,vi} from 'vitest';
import {allPages,fixtureStatus,kickoff} from './sportmonks-data';
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
it('maps SportMonks final, postponed and live states into the existing calendar contract',()=>{
 expect(fixtureStatus({state:{state:'FT_PEN'}})).toBe('PEN');
 expect(fixtureStatus({state:{state:'INPLAY_2ND_HALF'}})).toBe('2H');
 expect(fixtureStatus({state:{state:'POSTPONED'}})).toBe('PST');
 expect(fixtureStatus({state:undefined as never,state_id:5})).toBe('FT');
 expect(()=>fixtureStatus({state:{state:'UNKNOWN'}})).toThrow('Unsupported');
 expect(kickoff('2026-09-18 19:00:00')).toBe('2026-09-18T19:00:00.000Z');
});
it('consumes every provider page before returning complete roster data',async()=>{
 vi.stubEnv('SPORTMONKS_API_TOKEN','test');
 const mock=vi.fn(async(url:URL)=>new Response(JSON.stringify({data:[{id:Number(url.searchParams.get('page'))}],pagination:{has_more:url.searchParams.get('page')==='1'}})));
 vi.stubGlobal('fetch',mock);
 expect(await allPages('leagues')).toEqual({rows:[{id:1},{id:2}],requestsUsed:2});
 expect(mock).toHaveBeenCalledTimes(2);
});
