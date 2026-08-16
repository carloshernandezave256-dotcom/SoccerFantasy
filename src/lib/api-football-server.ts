const API_BASE="https://v3.football.api-sports.io";

export function apiFootballKey(){
  const key=process.env.API_FOOTBALL_KEY;
  if(!key)throw new Error("API_FOOTBALL_KEY is not configured for this deployment.");
  return key;
}

export async function apiFootball<T>(path:string):Promise<T>{
  const response=await fetch(`${API_BASE}/${path}`,{headers:{"x-apisports-key":apiFootballKey()},cache:"no-store"});
  if(!response.ok)throw new Error(`API-Football returned ${response.status}`);
  const body=await response.json();
  if(body.errors&&Object.keys(body.errors).length)throw new Error(Object.values(body.errors).join(", "));
  return body as T;
}

export function playerHeadshot(playerId:number){return `https://media.api-sports.io/football/players/${playerId}.png`}
