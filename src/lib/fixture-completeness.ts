import type {ProviderPlayerPage} from './live-score-domain';

export type ProviderLineup = {
  team:{id:number};
  startXI:Array<{player:{id:number}}>;
  substitutes:Array<{player:{id:number}}>;
};

/** Independent squad reconciliation. Null minutes mean unknown, never confirmed DNP. */
export function fixtureCompleteness(
  page:ProviderPlayerPage,
  lineups:ProviderLineup[],
  mapping:ReadonlyMap<number,number>,
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
    for(const id of squad){
      const entries=stats.players.filter(entry=>entry.player.id===id);
      const minutes=entries[0]?.statistics[0]?.games.minutes;
      if(entries.length!==1||!mapping.has(id)||typeof minutes!=='number'||!Number.isFinite(minutes)||minutes<0)
        return {complete:false,reason:'Squad player missing mapped statistics or explicit minutes'};
      if(lineup.startXI.some(row=>row.player.id===id)&&minutes<=0)
        return {complete:false,reason:'Starter appearance not reconciled'};
    }
    if(stats.players.some(entry=>!squad.includes(entry.player.id)||!mapping.has(entry.player.id)))
      return {complete:false,reason:'Statistics contain an unreconciled player'};
  }
  return {complete:true,reason:'Both full squads reconciled with explicit minutes'};
}
