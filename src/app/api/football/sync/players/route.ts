import {NextRequest,NextResponse} from "next/server";
import {apiFootball,playerHeadshot} from "@/lib/api-football-server";

const competitions=[{id:39,name:"Premier League"},{id:140,name:"La Liga"},{id:135,name:"Serie A"},{id:78,name:"Bundesliga"},{id:61,name:"Ligue 1"}];
type ApiPage={paging:{current:number;total:number};response:Array<{player:{id:number;name:string;nationality:string|null;photo:string|null};statistics:Array<{team:{name:string};games:{position:string|null}}>} >};

export const maxDuration=300;

export async function POST(request:NextRequest){
  const authorization=request.headers.get("authorization")??"";
  if(!authorization.startsWith("Bearer "))return NextResponse.json({error:"Sign in is required."},{status:401});
  const supabaseUrl=process.env.NEXT_PUBLIC_SUPABASE_URL??"https://ocabrgbrkqmsnalbfzvx.supabase.co";
  const publishableKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY??"sb_publishable_DA08c5KwmYXpru6CdrRfHA_4Qe2z3M-";
  const serviceRoleKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!serviceRoleKey)return NextResponse.json({error:"Server database credential is not configured."},{status:503});
  const userHeaders={apikey:publishableKey,Authorization:authorization,"Content-Type":"application/json"};
  const adminHeaders={apikey:serviceRoleKey,Authorization:`Bearer ${serviceRoleKey}`,"Content-Type":"application/json"};
  const leaguesResponse=await fetch(`${supabaseUrl}/rest/v1/rpc/my_leagues`,{method:"POST",headers:userHeaders,body:"{}",cache:"no-store"});
  const leagues=leaguesResponse.ok?await leaguesResponse.json():[];
  if(!leagues.some((league:{is_commissioner:boolean})=>league.is_commissioner))return NextResponse.json({error:"Commissioner access required."},{status:403});
  const now=new Date(),season=now.getUTCMonth()<6?now.getUTCFullYear()-1:now.getUTCFullYear();
  const seasonCandidates=[season,season-1,season-2];
  const seasonsUsed:Record<string,number>={};
  const unavailable:string[]=[];
  let imported=0,requestsUsed=0;
  for(const competition of competitions){
    let page=1,total=1,selectedSeason:number|null=null,body:ApiPage|null=null;
    for(const candidate of seasonCandidates){
      body=await apiFootball<ApiPage>(`players?league=${competition.id}&season=${candidate}&page=1`);requestsUsed++;
      if(body.response.length){selectedSeason=candidate;break}
    }
    if(!body||selectedSeason===null){unavailable.push(competition.name);continue}
    seasonsUsed[competition.name]=selectedSeason;
    total=body.paging.total;
    while(page<=total){
      if(page>1){body=await apiFootball<ApiPage>(`players?league=${competition.id}&season=${selectedSeason}&page=${page}`);requestsUsed++}
      const players=body.response.flatMap(entry=>{const stat=entry.statistics[0];if(!stat?.team?.name)return[];return[{apiFootballId:entry.player.id,fullName:entry.player.name,nationality:entry.player.nationality,photoUrl:entry.player.photo??playerHeadshot(entry.player.id),position:stat.games.position??"Attacker",club:stat.team.name,competition:competition.name}]});
      for(let index=0;index<players.length;index+=500){
        const response=await fetch(`${supabaseUrl}/rest/v1/rpc/sync_api_football_players`,{method:"POST",headers:adminHeaders,body:JSON.stringify({p_players:players.slice(index,index+500)}),cache:"no-store"});
        if(!response.ok)throw new Error((await response.text())||"Player database sync failed");
        imported+=Number(await response.json())||0;
      }
      page++;
    }
  }
  return NextResponse.json({ok:true,requestedSeason:season,seasonsUsed,unavailable,imported,requestsUsed});
}
