import {describe,it,expect} from 'vitest';
import {parseFotmobPage,doubtfulSquad} from './fotmob-doubtful';
const members=Array.from({length:11},(_,i)=>({id:i+1,name:`Player ${i+1}`,injury:null as unknown}));
function page(injury:unknown){return {fallback:{'team-10':{details:{id:10},squad:{squad:[{members:[{...members[0],injury},...members.slice(1)]}]}}}};}
describe('FotMob doubtful review',()=>{
 it('extracts only structured page data',()=>expect(parseFotmobPage('<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"test":true}}}</script>')).toEqual({test:true}));
 it('rejects a missing payload instead of showing an empty list',()=>expect(()=>parseFotmobPage('<html>Unavailable</html>')).toThrow());
 it('includes explicit doubtful players',()=>expect(doubtfulSquad(page({expectedReturn:'Doubtful'}),10,'Club','League','https://www.fotmob.com/teams/10/squad/club')).toEqual([expect.objectContaining({id:1,status:'Doubtful',source:'FotMob'})]));
 it.each(['Early October 2026','Back in training','Unknown',null])('does not turn %s into doubtful',value=>expect(doubtfulSquad(page({expectedReturn:value}),10,'Club','League','source')).toEqual([]));
 it('rejects a different club',()=>expect(()=>doubtfulSquad(page({expectedReturn:'Doubtful'}),20,'Other','League','source')).toThrow());
 it('rejects an empty squad',()=>expect(()=>doubtfulSquad({details:{id:10},squad:[]},10,'Club','League','source')).toThrow());
});
