const API_BASE="https://v3.football.api-sports.io";

export function apiFootballKey(){
  const key=process.env.API_FOOTBALL_KEY;
  if(!key)throw new Error("API_FOOTBALL_KEY is not configured for this deployment.");
  return key;
}

export async function apiFootball<T>(path:string):Promise<T>{
  for(let attempt=0;attempt<4;attempt++){
    const response=await fetch(`${API_BASE}/${path}`,{headers:{"x-apisports-key":apiFootballKey()},cache:"no-store"});
    if(!response.ok){
      if(response.status===429&&attempt<3){await new Promise(resolve=>setTimeout(resolve,15000*(attempt+1)));continue}
      throw new Error(`API-Football returned ${response.status}`);
    }
    const body=await response.json();
    if(body.errors&&Object.keys(body.errors).length){
      const message=Object.values(body.errors).join(", ");
      if(message.toLowerCase().includes("too many requests")&&attempt<3){await new Promise(resolve=>setTimeout(resolve,15000*(attempt+1)));continue}
      throw new Error(message);
    }
    return body as T;
  }
  throw new Error("API-Football rate limit did not reset in time.");
}

export function playerHeadshot(playerId:number){return `https://media.api-sports.io/football/players/${playerId}.png`}
