import type {FixturePlayerStatRow} from './live-score-domain';

export type SportMonksFixture = {
 id:number; league_id:number; starting_at:string; state:{state:string};
 participants:Array<{id:number;name:string;meta:{location:string}}>;
 scores:Array<{description:string;participant_id:number;score:{goals:number}}>;
 events:Array<{id:number;type_id:number;player_id:number|null;related_player_id:number|null;participant_id:number;player_name?:string;related_player_name?:string;rescinded:boolean|null}>;
 lineups:Array<{player_id:number;team_id:number;type_id:number;player_name:string;
 details:Array<{type_id:number;data:{value:number|null};type?:{code:string}}> | null}>;
};
export type SportMonksSource={fixture_id:number;sportmonks_id:number;raw_data:SportMonksFixture;player_map:Record<string,number>};
export type FixtureContext={fixture_id:number;kickoff:string;competition_id:number;home_score:number;away_score:number};
const leagues:Record<number,number>={8:39,82:78,301:61,384:135,564:140};
/** Only reviewed identity maps are accepted. Missing appearance evidence never becomes a DNP by default. */
export function normalizeSportMonks(source:SportMonksSource,context:FixtureContext,observedAt:string){
 const f=source.raw_data;
 const fail=(message:string):never=>{throw new Error(`SportMonks ${f.id}: ${message}`);};
 if(f.id!==source.sportmonks_id||context.fixture_id!==source.fixture_id||leagues[f.league_id]!==context.competition_id
   ||Date.parse(f.starting_at.replace(' ','T')+'Z')!==Date.parse(context.kickoff))fail('fixture identity mismatch');
 if(!['FT','AET','FT_PEN'].includes(f.state?.state))fail('fixture is not final');
 if(f.participants?.length!==2||!Array.isArray(f.events)||!Array.isArray(f.lineups))fail('incomplete squads or events');
 const home=f.participants.find(p=>p.meta.location==='home'); const away=f.participants.find(p=>p.meta.location==='away');
 if(!home||!away||home.id===away.id)fail('invalid participants');
 const scores=new Map(f.scores.filter(s=>s.description==='CURRENT').map(s=>[s.participant_id,s.score.goals]));
 if(scores.get(home!.id)!==context.home_score||scores.get(away!.id)!==context.away_score)fail('final scores disagree with canonical fixture');
 const events=f.events.filter(e=>e.rescinded!==true).map(e=>{
  // Some event IDs lag the lineup identity; accept only a unique exact name on the same team.
  const resolve=(id:number|null,name?:string)=>{
   if(id===null||f.lineups.some(l=>l.player_id===id))return id;
   const matches=f.lineups.filter(l=>l.team_id===e.participant_id&&l.player_name.trim()===name?.trim());
   return matches.length===1?matches[0].player_id:id;
  };
  return {...e,player_id:resolve(e.player_id,e.player_name),related_player_id:resolve(e.related_player_id,e.related_player_name)};
 });
 if(new Set(events.map(e=>e.id)).size!==events.length)fail('duplicate events');
 const seen=new Set<number>();const mapped=new Set<number>(); const rows:FixturePlayerStatRow[]=[];
 for(const team of f.participants){
  const squad=f.lineups.filter(l=>l.team_id===team.id);
  if(squad.filter(l=>l.type_id===11).length!==11||squad.some(l=>![11,12].includes(l.type_id)))fail('starting eleven incomplete');
  const subs=events.filter(e=>e.type_id===18&&e.participant_id===team.id);
  const subIds=new Set(subs.flatMap(e=>[e.player_id,e.related_player_id]));
  if(subs.some(e=>!squad.some(l=>l.player_id===e.player_id)||!squad.some(l=>l.player_id===e.related_player_id)))fail('unreconciled substitution');
  for(const l of squad){
   const playerId=Number(source.player_map[l.player_id]);
   if(!Number.isSafeInteger(playerId)||playerId<=0||mapped.has(playerId)||seen.has(l.player_id))fail(`missing or duplicate player mapping: ${l.player_name}`);
   mapped.add(playerId);seen.add(l.player_id);
   const details=l.details??[];
   if(new Set(details.map(d=>d.type_id)).size!==details.length)fail(`duplicate stats: ${l.player_name}`);
   const stats=new Map(details.map(d=>[d.type_id,d.data.value]));
   const value=(id:number)=>{const n=stats.get(id);if(n===null||n===undefined)return 0;if(typeof n!=='number'||!Number.isFinite(n)||n<0)fail(`invalid stat ${id}: ${l.player_name}`);return n;};
   let minutes=stats.get(119);
   // Cumulative minutes include stoppage time and still prove a short late appearance.
   if(minutes==null&&value(117172)>0&&value(117172)<10)minutes=value(117172);
   if(minutes===null||minutes===undefined){
    if(l.type_id!==12||subIds.has(l.player_id)||details.length||events.some(e=>[14,15,16,17].includes(e.type_id)&&(e.player_id===l.player_id||e.related_player_id===l.player_id)))fail(`missing appearance minutes: ${l.player_name}`);
    minutes=0;
   }
   if(typeof minutes!=='number'||!Number.isFinite(minutes)||minutes<0||minutes>130||(l.type_id===11&&minutes<=0))fail(`invalid minutes: ${l.player_name}`);
   
   // Core fields must be present for everyone who played; sparse exceptional events may be absent at zero.
   if(minutes>=10&&(!stats.has(118)||(!stats.has(80)&&!stats.has(120))))fail(`incomplete scoring statistics: ${l.player_name}`);
   const count=(type:number)=>events.filter(e=>e.type_id===type&&e.player_id===l.player_id).length;
   const penalties=value(111);const own=value(324);
   let goals=value(52);
   const scoredEvents=count(14)+count(16);
   // An own-goal event may retain the attacking player's name while the defender's
   // own-goal statistic carries the corrected attribution. Never award both goals.
   if(goals!==scoredEvents){
    const ownGoalEvents=count(15);
    const opposingOwnGoals=f.lineups.filter(p=>p.team_id!==team.id).reduce((n,p)=>n+(p.details??[]).filter(d=>d.type_id===324).reduce((a,d)=>a+Number(d.data.value??0),0),0);
    if(ownGoalEvents>0&&goals===scoredEvents+ownGoalEvents&&opposingOwnGoals>=ownGoalEvents)goals=scoredEvents;
    else fail(`goal attribution does not reconcile: ${l.player_name}`);
   }
   if(penalties!==count(16)||value(112)!==count(17))fail(`penalty or own-goal events disagree: ${l.player_name}`);

   rows.push({fixture_id:source.fixture_id,player_id:playerId,minutes,rating:stats.get(118)??null,
    goals,assists:value(79),shots_on_target:value(86),completed_passes:value(116),
    tackles_won:value(27267),penalty_goals:penalties,
    penalties_missed:value(112),penalties_conceded:value(114),saves:value(57),penalties_saved:value(113),
    goals_conceded:scores.get(team.id===home!.id?away!.id:home!.id)!,yellow_cards:value(84),
    second_yellow_cards:value(85),red_cards:value(83),own_goals:own,man_of_the_match:false,source_updated_at:observedAt});
  }
 }
 if(seen.size!==f.lineups.length)fail('unrecognized lineup team');
 // Aggregate player stats are authoritative for scorer attribution; events can retain stale attribution.
 for(const team of f.participants){
  const ownIds=new Set(f.lineups.filter(l=>l.team_id===team.id).map(l=>Number(source.player_map[l.player_id])));
  const total=rows.reduce((n,r)=>n+(ownIds.has(r.player_id)?Number(r.goals):Number(r.own_goals)),0);
  if(total!==scores.get(team.id))fail('player goals and own goals do not reconcile to final team score');
 }
 const goalEvents=events.filter(e=>[14,15,16].includes(e.type_id));
 if(goalEvents.length!==context.home_score+context.away_score)fail('goal events do not reconcile to score');
 return rows;
}
