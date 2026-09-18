import {afterEach,expect,it,vi} from 'vitest';
import {allPages,fixtureStatus,kickoff,profileMap} from './sportmonks-data';
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

it('ignores absent profiles only for unused bench players without events',async()=>{
 vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','test');vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://example.test');
 const mock=vi.fn(async()=>new Response(JSON.stringify({playerMap:{1:101}}),{headers:{'Content-Type':'application/json'}}));
 vi.stubGlobal('fetch',mock);
 const fixture={events:[],lineups:[{player_id:1,player_name:'Starter',team_id:10,type_id:11,details:[],player:{id:1}},
 {player_id:2,player_name:'Unknown bench',team_id:10,type_id:12,details:[]}]};
 expect(await profileMap(fixture as never,[{sportmonks_id:10,club:'Home',competition:'Premier League'}])).toEqual({1:101});
 const body=JSON.parse((mock.mock.calls as unknown as Array<[unknown,{body:string}]>)[0][1].body);
 expect(body.p_profiles).toHaveLength(1);
 fixture.lineups[1].type_id=11;
 await expect(profileMap(fixture as never,[{sportmonks_id:10,club:'Home',competition:'Premier League'}])).rejects.toThrow('Missing SportMonks profile');
});
