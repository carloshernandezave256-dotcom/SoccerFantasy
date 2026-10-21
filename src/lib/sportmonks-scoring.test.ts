import {describe,it,expect} from 'vitest';
import {normalizeSportMonks,type SportMonksSource,type FixtureContext} from './sportmonks-scoring';
import {source, reviewedDovbyk, dovbykContext} from './test-fixtures/sportmonks';
const context={fixture_id:1,kickoff:'2026-09-12T14:00:00Z',competition_id:39,home_score:0,away_score:0};
const normalize=(s=source(),c=context)=>normalizeSportMonks(s,c,'2026-09-18T12:00:00Z');
describe('SportMonks scoring',()=>{
 it('uses completed passes and confirms an unused substitute',()=>{const rows=normalize();expect(rows[0].completed_passes).toBe(40);expect(rows.find(r=>r.player_id===1022)!.minutes).toBe(0);});
 it('rejects unknown or duplicated identities',()=>{const s=source();delete s.player_map[1];expect(()=>normalize(s)).toThrow('mapping');s.player_map[1]=s.player_map[2];expect(()=>normalize(s)).toThrow('mapping');});
 it('rejects a starter with missing minutes',()=>{const s=source();s.raw_data.lineups[0].details=[];expect(()=>normalize(s)).toThrow('minutes');});
 it('does not convert a late stoppage-time appearance into a DNP',()=>{const s=source();s.raw_data.lineups[22].details=[{type_id:117172,data:{value:2}}];expect(normalize(s).find(r=>r.player_id===1022)!.minutes).toBe(2);});
 it('rejects mismatched matches and nonfinal responses',()=>{expect(()=>normalize(source(),{...context,competition_id:140})).toThrow('identity');const s=source();s.raw_data.state.state='INPLAY';expect(()=>normalize(s)).toThrow('not final');});
 it('rejects incomplete stats for a substantial appearance',()=>{const s=source();s.raw_data.lineups[0].details=[{type_id:119,data:{value:90}}];expect(()=>normalize(s)).toThrow('incomplete scoring');});
 it('does not confuse tackles attempted with tackles won',()=>{const s=source();s.raw_data.lineups[0].details!.push({type_id:78,data:{value:5}});expect(normalize(s)[0].tackles_won).toBe(0);});
 it('retains second-yellow dismissals',()=>{const s=source();s.raw_data.lineups[0].details!.push({type_id:85,data:{value:1}});expect(normalize(s)[0].second_yellow_cards).toBe(1);});
 it('does not award both an own goal and a stale scorer statistic',()=>{const s=source();s.raw_data.scores[0].score.goals=1;
  s.raw_data.lineups[0].details!.push({type_id:52,data:{value:1}});
  s.raw_data.lineups[11].details!.push({type_id:324,data:{value:1}});
  s.raw_data.events=[{id:1,type_id:15,participant_id:10,player_id:1,related_player_id:null,rescinded:null}];
  const rows=normalize(s,{...context,home_score:1});expect(rows[0].goals).toBe(0);expect(rows.find(r=>r.player_id===1011)!.own_goals).toBe(1);
 });
 it('rejects a missing substitution identity instead of guessing',()=>{const s=source();s.raw_data.events=[{id:1,type_id:18,participant_id:10,player_id:9999,related_player_id:1,rescinded:null}];expect(()=>normalize(s)).toThrow('substitution');});
});

it('keeps missing live minutes unknown but rejects the same gap at full time',()=>{
 const s=source();s.raw_data.state.state='INPLAY_1ST_HALF';s.raw_data.lineups[0].details=[];
 const rows=normalizeSportMonks(s,context,'2026-09-12T14:03:00Z',{live:true});
 expect(rows.some(r=>r.player_id===1000)).toBe(false);
 s.raw_data.state.state='FT';
 expect(()=>normalizeSportMonks(s,context,'2026-09-12T16:00:00Z',{live:true})).toThrow('minutes');
});

it('does not block known scorers for an unmapped unused substitute',()=>{
 const s=source();delete s.player_map[23];
 expect(normalize(s)).toHaveLength(22);
 s.raw_data.state.state='INPLAY_2ND_HALF';
 expect(normalizeSportMonks(s,context,'2026-09-12T15:20:00Z',{live:true})).toHaveLength(22);
});
it('still rejects an unmapped substitute with appearance or event evidence',()=>{
 const s=source();delete s.player_map[23];
 s.raw_data.lineups[22].details=[{type_id:119,data:{value:1}}];
 expect(()=>normalize(s)).toThrow('mapping');
 s.raw_data.lineups[22].details=[];
 s.raw_data.events=[{id:1,type_id:18,player_id:23,related_player_id:1,participant_id:10,rescinded:false}];
 expect(()=>normalize(s)).toThrow('mapping');
});

it('ignores missing IDs on unrelated events for an unidentified unused bench player',()=>{
 const s=source();delete s.player_map[23];s.raw_data.lineups[22].player_id=null;
 s.raw_data.events=[{id:1,type_id:19,player_id:1,related_player_id:null,participant_id:10,rescinded:false}];
 expect(normalize(s)).toHaveLength(22);
 s.raw_data.events[0].player_name='Player 23';
 expect(()=>normalize(s)).toThrow('mapping');
});
it('preserves a confirmed bench yellow without inventing an appearance',()=>{
 const s=source();s.raw_data.lineups[22].details=[{type_id:84,data:{value:1}}];
 s.raw_data.events=[{id:1,type_id:19,player_id:23,related_player_id:null,participant_id:10,rescinded:false,on_bench:true}];
 expect(normalize(s).find(r=>r.player_id===1022)).toMatchObject({minutes:0,yellow_cards:1});
 delete s.raw_data.events[0].on_bench;
 expect(()=>normalize(s)).toThrow('minutes');
});
it('does not treat other stats or a substitution as an unused bench booking',()=>{
 const s=source();s.raw_data.lineups[22].details=[{type_id:84,data:{value:1}},{type_id:80,data:{value:2}}];
 s.raw_data.events=[{id:1,type_id:19,player_id:23,related_player_id:null,participant_id:10,rescinded:false,on_bench:true}];
 expect(()=>normalize(s)).toThrow('minutes');
 s.raw_data.lineups[22].details!.pop();
 s.raw_data.events.push({id:2,type_id:18,player_id:23,related_player_id:1,participant_id:10,rescinded:false});
 expect(()=>normalize(s)).toThrow('minutes');
});

function reviewedRetake(){
 const s=source();s.sportmonks_id=s.raw_data.id=19713560;
 s.raw_data.participants[0].id=597;
 s.raw_data.scores[0].participant_id=597;s.raw_data.scores[0].score.goals=1;
 for(const l of s.raw_data.lineups)if(l.team_id===10)l.team_id=597;
 s.raw_data.lineups[0].player_id=37325012;s.raw_data.lineups[1].player_id=1371;
 delete s.player_map[1];delete s.player_map[2];s.player_map[37325012]=1000;s.player_map[1371]=1001;
 s.raw_data.lineups[1].details!.push({type_id:52,data:{value:1}},{type_id:111,data:{value:1}});
 s.raw_data.events=[
  {id:158169454,type_id:17,player_id:37325012,related_player_id:null,participant_id:597,rescinded:null},
  {id:158169510,type_id:16,player_id:1371,related_player_id:null,participant_id:597,rescinded:null},
 ];
 return s;
}
it('reconciles the reviewed voided Hojlund kick without charging a missed penalty',()=>{
 const s=reviewedRetake();const before=JSON.stringify(s.raw_data);
 const rows=normalize(s,{...context,home_score:1});
 expect(rows.find(r=>r.player_id===1000)!.penalties_missed).toBe(0);
 expect(rows.find(r=>r.player_id===1001)).toMatchObject({goals:1,penalty_goals:1});
 expect(JSON.stringify(s.raw_data)).toBe(before);
});
it('does not extrapolate the reviewed correction to another fixture or event',()=>{
 const s=reviewedRetake();s.sportmonks_id=s.raw_data.id=19713561;
 expect(()=>normalize(s,{...context,home_score:1})).toThrow('events disagree');
 s.sportmonks_id=s.raw_data.id=19713560;s.raw_data.events[0].id=999;
 expect(()=>normalize(s,{...context,home_score:1})).toThrow('events disagree');
});
it('does not void a missed kick when the replacement penalty is rescinded',()=>{
 const s=reviewedRetake();s.raw_data.events[1].rescinded=true;
 s.raw_data.lineups[1].details=s.raw_data.lineups[1].details!.filter(d=>![52,111].includes(d.type_id));
 s.raw_data.scores[0].score.goals=0;
 expect(()=>normalize(s)).toThrow('events disagree');
});

it.each([118,80])('rejects null core evidence instead of certifying a final result (%s)',type=>{
 const s=source();s.raw_data.lineups[0].details!.find(d=>d.type_id===type)!.data.value=null;
 expect(()=>normalize(s)).toThrow('incomplete scoring statistics');
});
it('rejects explicitly null scoring statistics rather than silently replacing them with zero',()=>{
 const s=source();s.raw_data.lineups[0].details!.find(d=>d.type_id===116)!.data.value=null;
 expect(()=>normalize(s)).toThrow('invalid stat 116');
});


const dovbyk = (s: SportMonksSource) => s.raw_data.lineups.find(lineup => lineup.player_id === 205978)!;
const normalizeDovbyk = (s = reviewedDovbyk(), c = dovbykContext) =>
 normalizeSportMonks(s, c, '2026-10-21T18:39:02Z');
function deepFreeze(value: object) {
 Object.freeze(value);
 for (const child of Object.values(value)) if (child && typeof child === 'object') deepFreeze(child);
}

describe('reviewed Dovbyk omitted core statistics', () => {
 it('reports provenance only after a supplement and successful whole-fixture validation', () => {
  const s = reviewedDovbyk();
  const notes: string[] = [];
  const options = {onReviewedEvidence: (note: string) => notes.push(note)};
  normalizeSportMonks(s, dovbykContext, '2026-10-21T18:39:02Z', options);
  expect(notes).toHaveLength(1);
  expect(notes[0]).toContain('FotMob match 5749702, player 655696');
  expect(notes[0]).toContain('omitted passes/accurate passes/touches only (SportMonks 80/116/120)');
  notes.length = 0;
  // This fails after the home team's supplemented player has already normalized.
  s.raw_data.lineups[11].details!.push({type_id: 79, data: {value: null}});
  expect(() => normalizeSportMonks(s, dovbykContext, '2026-10-21T18:39:02Z', options)).toThrow('invalid stat 79');
  expect(notes).toEqual([]);
 });

 it('does not report reviewed evidence for ordinary, live, or later complete provider data', () => {
  const notes: string[] = [];
  const options = {live: true, onReviewedEvidence: (note: string) => notes.push(note)};
  normalizeSportMonks(source(), context, '2026-10-21T18:39:02Z', options);
  const s = reviewedDovbyk();
  s.raw_data.state.state = 'INPLAY_2ND_HALF';
  normalizeSportMonks(s, dovbykContext, '2026-10-21T18:39:02Z', options);
  s.raw_data.state.state = 'FT';
  dovbyk(s).details!.push(...[80, 116, 120].map(type_id => ({type_id, data: {value: 0}})));
  normalizeSportMonks(s, dovbykContext, '2026-10-21T18:39:02Z', options);
  expect(notes).toEqual([]);
 });

 it('supplements the exact appearance while preserving the raw source and repeated results', () => {
  const s = reviewedDovbyk();
  const before = JSON.stringify(s);
  deepFreeze(s);
  const rows = normalizeDovbyk(s);
  expect(rows.find(row => row.player_id === 2178)).toMatchObject({
   fixture_id: 1550149, minutes: 14, rating: 6.46, completed_passes: 0,
  });
  expect(normalizeDovbyk(s)).toEqual(rows);
  expect(JSON.stringify(s)).toBe(before);
  expect(dovbyk(s).details!.map(detail => detail.type_id)).toEqual([119, 117172, 88, 118]);
 });

 it.each([80, 116, 120])('preserves an explicit compatible zero for %s and fills only omissions', type => {
  const s = reviewedDovbyk();
  dovbyk(s).details!.push({type_id: type, data: {value: 0}});
  const before = structuredClone(s);
  expect(normalizeDovbyk(s).find(row => row.player_id === 2178)!.completed_passes).toBe(0);
  expect(s).toEqual(before);
 });

 const identityChanges: Array<[string, (s: SportMonksSource, c: FixtureContext) => void]> = [
  ['provider fixture', s => { s.raw_data.id = s.sportmonks_id = 19713558; }],
  ['canonical fixture', (s, c) => { s.fixture_id = c.fixture_id = 1550150; }],
  ['provider player', s => {
   const l = dovbyk(s); l.player_id = 205979;
   s.player_map['205979'] = s.player_map['205978']; delete s.player_map['205978'];
   s.raw_data.events[0].player_id = 205979;
  }],
  ['canonical mapping', s => { s.player_map['205978'] = 999999; }],
  ['player name', s => { dovbyk(s).player_name = 'Another Player'; }],
  ['lineup identity', s => { dovbyk(s).id = 14675032044; }],
  ['missing lineup identity', s => { delete dovbyk(s).id; }],
  ['kickoff', (s, c) => { s.raw_data.starting_at = '2026-10-18 16:00:00'; c.kickoff = '2026-10-18T16:00:00Z'; }],
  ['competition', (s, c) => { s.raw_data.league_id = 8; c.competition_id = 39; }],
  ['home club name', s => { s.raw_data.participants[0].name = 'Another Club'; }],
  ['away club name', s => { s.raw_data.participants[1].name = 'Another Club'; }],
  ['team identity', s => {
   s.raw_data.participants[0].id = 8514;
   s.raw_data.scores[0].participant_id = 8514;
   for (const l of s.raw_data.lineups) if (l.team_id === 8513) l.team_id = 8514;
   for (const event of s.raw_data.events) if (event.participant_id === 8513) event.participant_id = 8514;
  }],
  ['minutes', s => { dovbyk(s).details!.find(detail => detail.type_id === 119)!.data.value = 15; }],
  ['cumulative minutes', s => { dovbyk(s).details!.find(detail => detail.type_id === 117172)!.data.value = 19; }],
  ['score', (s, c) => { s.raw_data.scores[0].score.goals = c.home_score = 2; }],
  ['substitution identity', s => { s.raw_data.events[0].id = 158273338; }],
  ['substitution time', s => { s.raw_data.events[0].minute = 77; }],
  ['substitution partner', s => { s.raw_data.events[0].related_player_id = 2; }],
  ['rescinded substitution', s => { s.raw_data.events[0].rescinded = true; }],
  ['bench-only event', s => { s.raw_data.events[0].on_bench = true; }],
  ['additional appearance event', s => {
   s.raw_data.events.push({id: 999, type_id: 19, player_id: 205978, related_player_id: null,
    participant_id: 8513, rescinded: false, on_bench: false});
  }],
 ];
 it.each(identityChanges)('does not extrapolate the evidence after changing %s', (_name, change) => {
  const s = reviewedDovbyk();
  const c = {...dovbykContext};
  change(s, c);
  expect(() => normalizeDovbyk(s, c)).toThrow(/incomplete scoring statistics|reviewed Dovbyk zero evidence/);
 });

 for (const type of [80, 116, 120]) {
  it.each([null, 1, -1, NaN, Infinity])(`rejects partial provider conflicts/nulls for ${type}: %s`, value => {
   const s = reviewedDovbyk();
   dovbyk(s).details!.push({type_id: type, data: {value}});
   const before = structuredClone(s);
   expect(() => normalizeDovbyk(s)).toThrow('conflicts with partial provider core statistics');
   expect(s).toEqual(before);
  });
 }

 it('leaves later complete provider statistics authoritative, including nonzero values', () => {
  const s = reviewedDovbyk();
  dovbyk(s).details!.push(
   {type_id: 80, data: {value: 20}}, {type_id: 116, data: {value: 14}}, {type_id: 120, data: {value: 25}},
  );
  // Complete provider evidence no longer depends on the old appearance snapshot.
  dovbyk(s).details!.find(detail => detail.type_id === 119)!.data.value = 15;
  const before = structuredClone(s);
  expect(normalizeDovbyk(s).find(row => row.player_id === 2178)).toMatchObject({minutes: 15, completed_passes: 14});
  expect(s).toEqual(before);
 });

 it.each([80, 116, 120])('rejects explicit null in an otherwise complete provider trio (%s)', type => {
  const s = reviewedDovbyk();
  dovbyk(s).details!.push(...[80, 116, 120].map(type_id => ({type_id, data: {value: type_id === type ? null : 0}})));
  expect(() => normalizeDovbyk(s)).toThrow('cannot replace invalid provider core statistics');
 });

 it('does not fabricate rating evidence or null scoring categories outside the reviewed trio', () => {
  const s = reviewedDovbyk();
  dovbyk(s).details = dovbyk(s).details!.filter(detail => detail.type_id !== 118);
  expect(() => normalizeDovbyk(s)).toThrow('incomplete scoring statistics');
  dovbyk(s).details!.push({type_id: 118, data: {value: 6.46}}, {type_id: 79, data: {value: null}});
  expect(() => normalizeDovbyk(s)).toThrow('invalid stat 79');
 });

 it('does not use final-match evidence for live or extra-time snapshots', () => {
  const s = reviewedDovbyk();
  s.raw_data.state.state = 'INPLAY_2ND_HALF';
  expect(() => normalizeDovbyk(s)).toThrow('fixture is not final');
  s.raw_data.state.state = 'AET';
  expect(() => normalizeDovbyk(s)).toThrow('incomplete scoring statistics');
 });

 it('still blocks an unrelated player with missing core evidence', () => {
  const s = reviewedDovbyk();
  s.raw_data.lineups[1].details = s.raw_data.lineups[1].details!.filter(detail => ![80, 116, 120].includes(detail.type_id));
  expect(() => normalizeDovbyk(s)).toThrow('incomplete scoring statistics: Player 2');
 });
});
