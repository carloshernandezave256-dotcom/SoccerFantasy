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

export const scallyContext: FixtureContext = {
 fixture_id: 1575218, kickoff: '2026-11-06T19:30:00Z', competition_id: 78, home_score: 3, away_score: 1,
};
// Synthetic squads with exact reviewed goal, substitution, and affected stat identities.
export function reviewedScally(): SportMonksSource {
 const s = source(), f = s.raw_data;
 s.fixture_id = 1575218; s.sportmonks_id = f.id = 19735119;
 f.league_id = 82; f.starting_at = '2026-11-06 19:30:00';
 f.participants = [{id:2708,name:'Hamburger SV',meta:{location:'home'}},
  {id:683,name:'Borussia Mönchengladbach',meta:{location:'away'}}];
 f.scores = [2708,683].map((participant_id,i) => ({description:'CURRENT',participant_id,score:{goals:i===0?3:1}}));
 for (const l of f.lineups) l.team_id = l.team_id === 10 ? 2708 : 683;
 const change = (index:number, id:number, name:string, canonical:number) => {
  const l = f.lineups[index]; delete s.player_map[String(l.player_id)];
  l.player_id = id; l.player_name = name; s.player_map[String(id)] = canonical; return l;
 };
 const hack = change(11,1452396,'Robin Hack',2716), scally = change(12,17158438,'Joe Scally',2726);
 hack.id = 14675265121; scally.id = 14675265123;
 hack.details!.find(d => d.type_id === 119)!.data.value = 56;
 hack.details!.push({id:2350553965,type_id:52,data:{value:1}});
 scally.details!.push({id:2350555039,type_id:79,data:{value:1}});
 const diks = change(22,25106,'Kevin Diks',2727); diks.team_id = 683;
 diks.details = [{type_id:119,data:{value:34}},{type_id:118,data:{value:7}},{type_id:80,data:{value:10}}];
 f.events = [{id:158559631,type_id:14,minute:44,player_id:17158438,player_name:'Joe Scally',related_player_id:null,participant_id:683,rescinded:null},
  {id:158560445,type_id:18,minute:56,player_id:25106,related_player_id:1452396,participant_id:683,rescinded:null,on_bench:false}];
 [[200872,158558982,11],[37691049,158560506,59],[37509380,158560704,70]].forEach(([player,id,minute],i) => {
  change(i,player,`Home scorer ${i}`,1000+i).details!.push({type_id:52,data:{value:1}});
  f.events.push({id,type_id:14,minute,player_id:player,related_player_id:null,participant_id:2708,rescinded:null});
 });
 return s;
}
