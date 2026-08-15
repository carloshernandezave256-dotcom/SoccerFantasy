export const ACTIVE_LEAGUE_KEY="xi-fantasy-active-league";

export function setActiveLeagueId(leagueId:string){
  if(typeof window!=="undefined")window.localStorage.setItem(ACTIVE_LEAGUE_KEY,leagueId);
}

export function resolveActiveLeague<T extends {league_id:string}>(leagues:T[],requested?:string|null):T|undefined{
  if(!leagues.length)return undefined;
  const stored=typeof window!=="undefined"?window.localStorage.getItem(ACTIVE_LEAGUE_KEY):null;
  const active=leagues.find(item=>item.league_id===stored)??leagues.find(item=>item.league_id===requested)??leagues[0];
  setActiveLeagueId(active.league_id);
  return active;
}
