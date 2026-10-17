import type {FixturePlayerStatRow} from './live-score-domain';

export type SportMonksFixture = {
 id:number; league_id:number; starting_at:string; state:{state:string};
 participants:Array<{id:number;name:string;meta:{location:string}}>;
 scores:Array<{description:string;participant_id:number;score:{goals:number}}>;
 events:Array<{id:number;type_id:number;player_id:number|null;related_player_id:number|null;participant_id:number;player_name?:string;related_player_name?:string;rescinded:boolean|null;on_bench?:boolean}>;
 lineups:Array<{player_id:number|null;team_id:number;type_id:number;player_name:string;
 details:Array<{type_id:number;data:{value:number|null};type?:{code:string}}> | null}>;
};
/** Match only real IDs or nonempty exact names, never two missing IDs. */
function referencesPlayer(e:SportMonksFixture['events'][number],l:SportMonksFixture['lineups'][number]){
 return e.participant_id===l.team_id && (
  (l.player_id!=null&&(e.player_id===l.player_id||e.related_player_id===l.player_id))
  ||(!!l.player_name?.trim()&&(e.player_name?.trim()===l.player_name.trim()||e.related_player_name?.trim()===l.player_name.trim())));
}
/** A bench disciplinary event explicitly marked on_bench does not prove an appearance. */
export function unusedSportMonksSubstitute(f:SportMonksFixture,l:SportMonksFixture['lineups'][number]){
 if(l.type_id!==12||!Array.isArray(l.details)||!Array.isArray(f.events))return false;
 const events=f.events.filter(e=>e.rescinded!==true&&referencesPlayer(e,l));
 if(events.some(e=>![19,20,21].includes(e.type_id)||e.on_bench!==true))return false;
 const cards=new Map([[84,19],[83,20],[85,21]]);
 return l.details.every(d=>cards.has(d.type_id)&&typeof d.data.value==='number'&&d.data.value>=0
  &&d.data.value===events.filter(e=>e.type_id===cards.get(d.type_id)).length);
}
/** Reviewed provider correction: Napoli–Frosinone, 10 October 2026.
 * Højlund's saved kick was voided for goalkeeper encroachment; De Bruyne scored
 * the retake. SportMonks leaves the original miss unrescinded in its timeline
 * while correctly omitting it from aggregate penalty-miss statistics.
 * Evidence: https://www.reuters.com/sports/soccer/inter-rout-parma-de-bruyne-double-lifts-napoli-2026-10-10/
 * Scope every identity and the replacement event; never infer voiding from VAR alone.
 * Keep the raw provider payload unchanged for audit.
 */
function reviewedVoidedPenalty(f:SportMonksFixture,e:SportMonksFixture['events'][number]){
 return f.id===19713560 && e.id===158169454 && e.type_id===17
  && e.player_id===37325012 && e.participant_id===597
  && f.events.some(r=>r.id===158169510&&r.type_id===16&&r.player_id===1371
   &&r.participant_id===597&&r.rescinded!==true)
  && f.lineups.some(l=>l.player_id===37325012&&l.team_id===597
   &&Array.isArray(l.details)&&!l.details.some(d=>d.type_id===112&&d.data.value!==0));
}
export type SportMonksSource={fixture_id:number;sportmonks_id:number;raw_data:SportMonksFixture;player_map:Record<string,number>};
export type FixtureContext={fixture_id:number;kickoff:string;competition_id:number;home_score:number;away_score:number};
const leagues:Record<number,number>={8:39,82:78,301:61,384:135,564:140};
/** Only reviewed identity maps are accepted. Missing appearance evidence never becomes a DNP by default. */
export function normalizeSportMonks(source:SportMonksSource,context:FixtureContext,observedAt:string,options:{live?:boolean}={}){
 const f=source.raw_data;
 const fail=(message:string):never=>{throw new Error(`SportMonks ${f.id}: ${message}`);};
 if(f.id!==source.sportmonks_id||context.fixture_id!==source.fixture_id||leagues[f.league_id]!==context.competition_id
   ||Date.parse(f.starting_at.replace(' ','T')+'Z')!==Date.parse(context.kickoff))fail('fixture identity mismatch');
 const final=['FT','AET','FT_PEN'].includes(f.state?.state);
 if(!final&&!options.live)fail('fixture is not final');
 if(f.participants?.length!==2||!Array.isArray(f.events)||!Array.isArray(f.lineups))fail('incomplete squads or events');
 const home=f.participants.find(p=>p.meta.location==='home'); const away=f.participants.find(p=>p.meta.location==='away');
 if(!home||!away||home.id===away.id)fail('invalid participants');
 const scores=new Map(f.scores.filter(s=>s.description==='CURRENT').map(s=>[s.participant_id,s.score.goals]));
 if(scores.get(home!.id)!==context.home_score||scores.get(away!.id)!==context.away_score)fail('final scores disagree with canonical fixture');
 const events=f.events.filter(e=>e.rescinded!==true&&!reviewedVoidedPenalty(f,e)).map(e=>{
  // Some event IDs lag the lineup identity; accept only a unique exact name on the same team.
  const resolve=(id:number|null,name?:string)=>{
   if(id===null||f.lineups.some(l=>l.player_id===id))return id;
   const matches=f.lineups.filter(l=>l.team_id===e.participant_id&&l.player_name.trim()===name?.trim());
   return matches.length===1?matches[0].player_id:id;
  };
  return {...e,player_id:resolve(e.player_id,e.player_name),related_player_id:resolve(e.related_player_id,e.related_player_name)};
 });
 if(new Set(events.map(e=>e.id)).size!==events.length)fail('duplicate events');
 const seen=new Set<string>();const mapped=new Set<number>(); const rows:FixturePlayerStatRow[]=[];
 for(const team of f.participants){
  const squad=f.lineups.filter(l=>l.team_id===team.id);
  if(squad.filter(l=>l.type_id===11).length!==11||squad.some(l=>![11,12].includes(l.type_id)))fail('starting eleven incomplete');
  const subs=events.filter(e=>e.type_id===18&&e.participant_id===team.id);
  const subIds=new Set(subs.flatMap(e=>[e.player_id,e.related_player_id]));
  if(subs.some(e=>!squad.some(l=>l.player_id===e.player_id)||!squad.some(l=>l.player_id===e.related_player_id)))fail('unreconciled substitution');
  for(const l of squad){
   const identity=l.player_id==null?`${l.team_id}:${l.player_name}`:String(l.player_id);
   const playerId=Number(source.player_map[String(l.player_id)]);
   if(!source.player_map[String(l.player_id)]&&unusedSportMonksSubstitute(f,l)){
    if(seen.has(identity))fail(`duplicate player mapping: ${l.player_name}`);
    seen.add(identity);continue;
   }
   if(!Number.isSafeInteger(playerId)||playerId<=0||mapped.has(playerId)||seen.has(identity))fail(`missing or duplicate player mapping: ${l.player_name}`);
   mapped.add(playerId);seen.add(identity);
   const details=l.details??[];
   if(new Set(details.map(d=>d.type_id)).size!==details.length)fail(`duplicate stats: ${l.player_name}`);
   const stats=new Map(details.map(d=>[d.type_id,d.data.value]));
   const value=(id:number)=>{const n=stats.get(id);if(n===null||n===undefined)return 0;if(typeof n!=='number'||!Number.isFinite(n)||n<0)fail(`invalid stat ${id}: ${l.player_name}`);return n;};
   let minutes=stats.get(119);
   // Cumulative minutes include stoppage time and still prove a short late appearance.
   if(minutes==null&&value(117172)>0&&value(117172)<10)minutes=value(117172);
   if(minutes===null||minutes===undefined){
    if(!final)continue;
    if(subIds.has(l.player_id)||!unusedSportMonksSubstitute(f,l))fail(`missing appearance minutes: ${l.player_name}`);
    minutes=0;
   }
   if(typeof minutes!=='number'||!Number.isFinite(minutes)||minutes<0||minutes>130||(final&&l.type_id===11&&minutes<=0))fail(`invalid minutes: ${l.player_name}`);
   
   // Core fields must be present for everyone who played; sparse exceptional events may be absent at zero.
   if(final&&minutes>=10&&(!stats.has(118)||(!stats.has(80)&&!stats.has(120))))fail(`incomplete scoring statistics: ${l.player_name}`);
   const count=(type:number)=>events.filter(e=>e.type_id===type&&e.player_id===l.player_id).length;
   const penalties=value(111);const own=value(324);
   let goals=value(52);
   const scoredEvents=count(14)+count(16);
   // An own-goal event may retain the attacking player's name while the defender's
   // own-goal statistic carries the corrected attribution. Never award both goals.
   if(final&&goals!==scoredEvents){
    const ownGoalEvents=count(15);
    const opposingOwnGoals=f.lineups.filter(p=>p.team_id!==team.id).reduce((n,p)=>n+(p.details??[]).filter(d=>d.type_id===324).reduce((a,d)=>a+Number(d.data.value??0),0),0);
    if(ownGoalEvents>0&&goals===scoredEvents+ownGoalEvents&&opposingOwnGoals>=ownGoalEvents)goals=scoredEvents;
    else fail(`goal attribution does not reconcile: ${l.player_name}`);
   }
   if(final&&(penalties!==count(16)||value(112)!==count(17)))fail(`penalty or own-goal events disagree: ${l.player_name}`);

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
 if(final)for(const team of f.participants){
  const ownIds=new Set(f.lineups.filter(l=>l.team_id===team.id).map(l=>Number(source.player_map[String(l.player_id)])));
  const total=rows.reduce((n,r)=>n+(ownIds.has(r.player_id)?Number(r.goals):Number(r.own_goals)),0);
  if(total!==scores.get(team.id))fail('player goals and own goals do not reconcile to final team score');
 }
 const goalEvents=events.filter(e=>[14,15,16].includes(e.type_id));
 if(final&&goalEvents.length!==context.home_score+context.away_score)fail('goal events do not reconcile to score');
 return rows;
}
