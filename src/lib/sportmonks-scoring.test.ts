import {describe,it,expect} from 'vitest';
import {normalizeSportMonks,type SportMonksSource} from './sportmonks-scoring';
function source():SportMonksSource{
 return {fixture_id:1,sportmonks_id:100,player_map:Object.fromEntries(Array.from({length:23},(_,i)=>[i+1,i+1000])),raw_data:{
  id:100,league_id:8,starting_at:'2026-09-12 14:00:00',state:{state:'FT'},
  participants:[{id:10,name:'Home',meta:{location:'home'}},{id:20,name:'Away',meta:{location:'away'}}],
  scores:[10,20].map(id=>({description:'CURRENT',participant_id:id,score:{goals:0}})),events:[],
  lineups:Array.from({length:23},(_,i)=>({player_id:i+1,player_name:`Player ${i+1}`,team_id:i<11||i===22?10:20,type_id:i===22?12:11,
   details:i===22?[]:[{type_id:119,data:{value:90}},{type_id:118,data:{value:7}},{type_id:80,data:{value:50}},{type_id:116,data:{value:40}}]})),
 }};
}
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
