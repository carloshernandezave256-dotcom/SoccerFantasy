import type {SportMonksSource, FixtureContext} from '../sportmonks-scoring';

export function source():SportMonksSource{
 return {fixture_id:1,sportmonks_id:100,player_map:Object.fromEntries(Array.from({length:23},(_,i)=>[i+1,i+1000])),raw_data:{
  id:100,league_id:8,starting_at:'2026-09-12 14:00:00',state:{state:'FT'},
  participants:[{id:10,name:'Home',meta:{location:'home'}},{id:20,name:'Away',meta:{location:'away'}}],
  scores:[10,20].map(id=>({description:'CURRENT',participant_id:id,score:{goals:0}})),events:[],
  lineups:Array.from({length:23},(_,i)=>({player_id:i+1,player_name:`Player ${i+1}`,team_id:i<11||i===22?10:20,type_id:i===22?12:11,
   details:i===22?[]:[{type_id:119,data:{value:90}},{type_id:118,data:{value:7}},{type_id:80,data:{value:50}},{type_id:116,data:{value:40}}]})),
 }};
}

export const dovbykContext: FixtureContext = {
 fixture_id: 1550149, kickoff: '2026-10-17T16:00:00Z', competition_id: 135,
 home_score: 1, away_score: 3,
};
// Synthetic squads, with the reviewed target's exact source/appearance identity.
export function reviewedDovbyk(): SportMonksSource {
 const s = source();
 s.fixture_id = 1550149;
 s.sportmonks_id = s.raw_data.id = 19713557;
 s.raw_data.league_id = 384;
 s.raw_data.starting_at = '2026-10-17 16:00:00';
 s.raw_data.participants = [
  {id: 8513, name: 'Bologna', meta: {location: 'home'}},
  {id: 2930, name: 'Inter', meta: {location: 'away'}},
 ];
 s.raw_data.scores = [
  {description: 'CURRENT', participant_id: 8513, score: {goals: 1}},
  {description: 'CURRENT', participant_id: 2930, score: {goals: 3}},
 ];
 for (const lineup of s.raw_data.lineups) lineup.team_id = lineup.team_id === 10 ? 8513 : 2930;
 s.raw_data.lineups[0].player_id = 34443308;
 s.raw_data.lineups[0].player_name = 'Nicolò Cambiaghi';
 delete s.player_map['1'];
 s.player_map['34443308'] = 1000;
 s.raw_data.lineups[22] = {
  id: 14675032043, player_id: 205978, team_id: 8513, type_id: 12, player_name: 'Artem Dovbyk',
  details: [
   {type_id: 119, data: {value: 14}}, {type_id: 117172, data: {value: 18}},
   {type_id: 88, data: {value: 1}}, {type_id: 118, data: {value: 6.46}},
  ],
 };
 delete s.player_map['23'];
 s.player_map['205978'] = 2178;
 s.raw_data.lineups[1].details!.push({type_id: 52, data: {value: 1}});
 s.raw_data.lineups[11].details!.push({type_id: 52, data: {value: 3}});
 s.raw_data.events = [
  {id: 158273337, type_id: 18, minute: 76, player_id: 205978, related_player_id: 34443308,
   participant_id: 8513, rescinded: null, on_bench: false},
  ...[2, 12, 12, 12].map((player_id, index) => ({
   id: index + 1, type_id: 14, player_id, related_player_id: null,
   participant_id: player_id === 2 ? 8513 : 2930, rescinded: null,
  })),
 ];
 return s;
}
