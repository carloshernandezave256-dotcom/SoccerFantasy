import type {ProviderPlayerPage,ProviderFixtureEvent} from './live-score-domain';

export type ProviderLineup = {
  team:{id:number};
  startXI:Array<{player:{id:number}}>;
  substitutes:Array<{player:{id:number}}>;
};

/** Null minutes remain unknown unless final squad and event evidence confirms an unused substitute. */
export function fixtureCompleteness(
  page:ProviderPlayerPage,
  lineups:ProviderLineup[],
  mapping:ReadonlyMap<number,number>,
  events?:ProviderFixtureEvent[],
):{complete:boolean;reason:string}{
  if(!['FT','AET','PEN'].includes(page.fixture.fixture.status.short))return {complete:false,reason:'Match not completed'};
  const teamIds=[page.fixture.teams.home.id,page.fixture.teams.away.id];
  if(lineups.length!==2||page.teams.length!==2)return {complete:false,reason:'Both team squads and statistics required'};
  for(const teamId of teamIds){
    const lineup=lineups.find(team=>team.team.id===teamId);
    const stats=page.teams.find(team=>team.team.id===teamId);
    if(!lineup||!stats||lineup.startXI.length!==11)return {complete:false,reason:'Starting lineup incomplete'};
    const squad=[...lineup.startXI,...lineup.substitutes].map(row=>row.player.id);
    if(new Set(squad).size!==squad.length)return {complete:false,reason:'Duplicate squad player'};
    const substitutions=events?.filter(event=>event.type.toLowerCase()==='subst' && event.team?.id===teamId);
    // Independent final event records must agree with every substitute who played.
    const eventIds=new Set(substitutions?.flatMap(event=>[event.player.id,event.assist?.id]).filter((id):id is number=>typeof id==='number'));
    const eventsReconciled=substitutions!==undefined && substitutions.every(event=>
      event.player.id!==null && event.assist?.id!=null && squad.includes(event.player.id) && squad.includes(event.assist.id)
      && [event.player.id,event.assist.id].every(id=>stats.players.some(p=>p.player.id===id && typeof p.statistics[0]?.games.minutes==='number' && p.statistics[0].games.minutes!>=0)))
      && lineup.substitutes.every(p=>!stats.players.some(row=>row.player.id===p.player.id && Number(row.statistics[0]?.games.minutes)>0) || eventIds.has(p.player.id));
    for(const id of squad){
      const entries=stats.players.filter(entry=>entry.player.id===id);
      const minutes=entries[0]?.statistics[0]?.games.minutes;
      const unused=entries.length===1 && entries[0].statistics.length===1 && minutes===null
        && entries[0].statistics[0].games.substitute===true
        && lineup.substitutes.some(row=>row.player.id===id) && eventsReconciled && !eventIds.has(id)
        && !events?.some(event=>event.type.toLowerCase()==='goal' && (event.player.id===id || event.assist?.id===id));
      if(entries.length!==1||!mapping.has(id)||(!unused && (typeof minutes!=='number'||!Number.isFinite(minutes)||minutes<0)))
        return {complete:false,reason:`Player ${id} missing mapped statistics or explicit minutes (team ${teamId})`};
      if(lineup.startXI.some(row=>row.player.id===id)&&Number(minutes)<=0)
        return {complete:false,reason:`Starter ${id} appearance not reconciled (team ${teamId})`};
    }
    if(stats.players.some(entry=>!squad.includes(entry.player.id)||!mapping.has(entry.player.id)))
      return {complete:false,reason:'Statistics contain an unreconciled player'};
  }
  return {complete:true,reason:'Both squads reconciled with minutes or confirmed unused-bench evidence'};
}
