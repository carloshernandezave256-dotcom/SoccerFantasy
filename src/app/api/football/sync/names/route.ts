import {NextRequest,NextResponse} from "next/server";
import {apiFootball} from "@/lib/api-football-server";
import {isDeveloperRequest} from "@/lib/developer-auth";

const competitions=[{id:39,name:"Premier League"},{id:140,name:"La Liga"},{id:135,name:"Serie A"},{id:78,name:"Bundesliga"},{id:61,name:"Ligue 1"}];
type TeamsPage={response:Array<{team:{id:number;name:string}}>};
type SquadPage={response:Array<{players:Array<{id:number;name:string}>}>};

export const maxDuration=300;

export async function POST(request:NextRequest){
 const authorization=request.headers.get("authorization")??"";
 if(!authorization.startsWith("Bearer "))return NextResponse.json({error:"Sign in is required."},{status:401});
 if(!await isDeveloperRequest(request))return NextResponse.json({error:"Developer access required."},{status:403});
 const supabaseUrl=process.env.NEXT_PUBLIC_SUPABASE_URL??"https://ocabrgbrkqmsnalbfzvx.supabase.co";
 const serviceRoleKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!serviceRoleKey)return NextResponse.json({error:"Server database credential is not configured."},{status:503});
 const adminHeaders={apikey:serviceRoleKey,Authorization:`Bearer ${serviceRoleKey}`,"Content-Type":"application/json"};
 try{
  const season=2026,names=new Map<number,string>();let requestsUsed=0;
  for(const competition of competitions){
   const teams=await apiFootball<TeamsPage>(`teams?league=${competition.id}&season=${season}`);requestsUsed++;
   for(const {team} of teams.response){
    const squad=await apiFootball<SquadPage>(`players/squads?team=${team.id}`);requestsUsed++;
    for(const group of squad.response)for(const player of group.players){const commonName=player.name.trim();if(commonName)names.set(player.id,commonName)}
   }
  }
  let updated=0;const players=[...names].map(([apiFootballId,commonName])=>({apiFootballId,commonName}));
  for(let index=0;index<players.length;index+=500){
   const response=await fetch(`${supabaseUrl}/rest/v1/rpc/sync_api_player_common_names`,{method:"POST",headers:adminHeaders,body:JSON.stringify({p_players:players.slice(index,index+500)}),cache:"no-store"});
   if(!response.ok)throw new Error((await response.text())||"Common-name database update failed");
   updated+=Number(await response.json())||0;
  }
  return NextResponse.json({ok:true,season,playersFound:players.length,updated,requestsUsed});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Common-name synchronization failed."},{status:502})}
}
