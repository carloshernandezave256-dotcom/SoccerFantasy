import {describe,it,expect} from 'vitest';
import {normalizeSportMonks,type SportMonksSource,type FixtureContext} from './sportmonks-scoring';
import {reviewedScally,scallyContext} from './test-fixtures/sportmonks';
const hack = (s:SportMonksSource) => s.raw_data.lineups.find(l => l.player_id === 1452396)!;
const scally = (s:SportMonksSource) => s.raw_data.lineups.find(l => l.player_id === 17158438)!;
const normalize = (s=reviewedScally(),c=scallyContext,notes:string[]=[],live=false) =>
 normalizeSportMonks(s,c,'2026-11-08T00:00:00Z',{live,onReviewedEvidence:note=>notes.push(note)});
const set = (s:SportMonksSource,who:'hack'|'scally',type:number,value:number|null) => {
 const l = who === 'hack' ? hack(s) : scally(s);
 const d = l.details!.find(d=>d.type_id === type);
 if(d) d.data.value=value; else l.details!.push({type_id:type,data:{value}});
};
function freeze(o:object) { Object.freeze(o); for(const v of Object.values(o)) if(v && typeof v === 'object') freeze(v); }
function corrected(s:SportMonksSource) { set(s,'hack',52,0);set(s,'scally',52,1);set(s,'scally',79,0);return s; }
describe('reviewed HSV–Gladbach scorer correction',()=>{
 it('corrects only reviewed goals/assist, retains immutable raw data, and records provenance once',()=>{
  const s=reviewedScally(), before=structuredClone(s), notes:string[]=[];
  const provider=normalize(corrected(structuredClone(s)));
  freeze(s);
  const rows=normalize(s,scallyContext,notes);
  expect(rows).toEqual(provider);
  expect(rows.find(r=>r.player_id===2716)).toMatchObject({goals:0,assists:0,minutes:56,completed_passes:40});
  expect(rows.find(r=>r.player_id===2726)).toMatchObject({goals:1,assists:0,minutes:90,completed_passes:40});
  expect(s).toEqual(before);expect(normalize(s)).toEqual(rows);
  expect(hack(s).details!.some(d=>d.type_id===79)).toBe(false);
  expect(notes).toHaveLength(1);expect(notes[0]).toContain('158559631');expect(notes[0]).toContain('https://datencenter.dfb.de/');
 });
 it('accepts later corrected provider tuples with explicit or omitted zero values without provenance',()=>{
  for(const sparse of [false,true]){
   const s=corrected(reviewedScally()),notes:string[]=[];
   if(sparse){hack(s).details=hack(s).details!.filter(d=>d.type_id!==52);scally(s).details=scally(s).details!.filter(d=>d.type_id!==79);}
   const before=structuredClone(s);normalize(s,scallyContext,notes);expect(notes).toEqual([]);expect(s).toEqual(before);
  }
 });
 it('lets fully corrected provider data supersede the historical goal minute without provenance',()=>{
  const s=corrected(reviewedScally()),notes:string[]=[];
  s.raw_data.events.find(e=>e.id===158560506)!.minute=60;
  const before=structuredClone(s);
  expect(normalize(s,scallyContext,notes).find(r=>r.player_id===2726)).toMatchObject({goals:1,assists:0});
  expect(notes).toEqual([]);expect(s).toEqual(before);
 });
 const changes:Array<[string,(s:SportMonksSource,c:FixtureContext)=>void]>=[
  ['provider fixture',s=>{s.raw_data.id=s.sportmonks_id=19735120;}],
  ['canonical fixture',(s,c)=>{s.fixture_id=c.fixture_id=1575219;}],
  ['kickoff',(s,c)=>{s.raw_data.starting_at='2026-11-07 19:30:00';c.kickoff='2026-11-07T19:30:00Z';}],
  ['competition',(s,c)=>{s.raw_data.league_id=8;c.competition_id=39;}],
  ['club name',s=>{s.raw_data.participants[0].name='Other';}],
  ['score',(s,c)=>{s.raw_data.scores[0].score.goals=c.home_score=4;}],
  ['Hack mapping',s=>{s.player_map['1452396']=99999;}],
  ['Scally mapping',s=>{s.player_map['17158438']=99999;}],
  ['lineup ID',s=>{hack(s).id=123;}],
  ['lineup name',s=>{scally(s).player_name='Other';}],
  ['minutes',s=>{set(s,'hack',119,57);}],
  ['goal ID',s=>{s.raw_data.events[0].id=123;}],
  ['goal time',s=>{s.raw_data.events[0].minute=45;}],
  ['home goal time with stale tuple',s=>{s.raw_data.events.find(e=>e.id===158560506)!.minute=60;}],
  ['goal scorer',s=>{s.raw_data.events[0].player_id=1452396;}],
  ['goal rescinded',s=>{s.raw_data.events[0].rescinded=true;}],
  ['assist attribution',s=>{s.raw_data.events[0].related_player_id=1452396;}],
  ['assist name',s=>{s.raw_data.events[0].related_player_name='Robin Hack';}],
  ['substitution time',s=>{s.raw_data.events[1].minute=57;}],
  ['substitution ID',s=>{s.raw_data.events[1].id=123;}],
  ['stat identity',s=>{hack(s).details!.find(d=>d.type_id===52)!.id=123;}],
  ['missing details',s=>{scally(s).details=null;}],
  ['duplicate stats',s=>{scally(s).details!.push({type_id:79,data:{value:1}});}],
  ['missing target',s=>{s.raw_data.lineups=s.raw_data.lineups.filter(l=>l.player_id!==17158438);}],
  ['partial Hack correction',s=>{set(s,'hack',52,0);}],
  ['partial Scally goal correction',s=>{set(s,'scally',52,1);}],
  ['partial Scally assist correction',s=>{set(s,'scally',79,0);}],
  ['new Hack assist',s=>{set(s,'hack',79,1);}],
  ['explicit Hack assist zero outside stale snapshot',s=>{set(s,'hack',79,0);}],
 ];
 it.each(changes)('blocks %s without emitting evidence',(_name,change)=>{
  const s=reviewedScally(),c={...scallyContext},notes:string[]=[];change(s,c);
  expect(()=>normalize(s,c,notes)).toThrow();expect(notes).toEqual([]);
 });
 for(const who of ['hack','scally'] as const) for(const type of [52,79]) {
  it.each([null,-1,NaN,Infinity,0.5])(`rejects malformed ${who} stat ${type}: %s`,value=>{
   const s=reviewedScally();set(s,who,type,value);expect(()=>normalize(s)).toThrow();
  });
 }
 it('never substitutes live or extra-time evidence',()=>{
  const s=reviewedScally(),notes:string[]=[];s.raw_data.state.state='INPLAY_2ND_HALF';
  expect(()=>normalize(s)).toThrow('not final');
  const rows=normalize(s,scallyContext,notes,true);
  expect(rows.find(r=>r.player_id===2716)!.goals).toBe(1);expect(notes).toEqual([]);
  s.raw_data.state.state='AET';expect(()=>normalize(s)).toThrow('goal attribution');
 });
 it('keeps unrelated missing/null statistics blocked and reports no success',()=>{
  for(const type of [118,116]){
   const s=reviewedScally(),notes:string[]=[];
   s.raw_data.lineups[13].details!.find(d=>d.type_id===type)!.data.value=null;
   expect(()=>normalize(s,scallyContext,notes)).toThrow();expect(notes).toEqual([]);
  }
 });
});

import retained from './test-fixtures/hsv-gladbach-20261106.json';
it('replays the retained provider fixture through all guards without changing the source',()=>{
 const s=structuredClone(retained.source) as unknown as SportMonksSource;
 const before=structuredClone(s), notes:string[]=[];
 const rows=normalize(s,retained.context,notes);
 expect(rows).toHaveLength(40);
 expect(rows.find(r=>r.player_id===s.player_map['200872'])).toMatchObject({goals:1});
 expect(rows.find(r=>r.player_id===2716)).toMatchObject({goals:0,assists:0,minutes:56});
 expect(rows.find(r=>r.player_id===2726)).toMatchObject({goals:1,assists:0,minutes:90});
 expect(rows).toEqual(normalize(corrected(structuredClone(s)),retained.context));
 expect(s).toEqual(before);expect(notes).toHaveLength(1);
});
