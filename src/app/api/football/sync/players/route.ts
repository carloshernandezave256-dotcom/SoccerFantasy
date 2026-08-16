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
  const common={apikey:publishableKey,Authorization:authorization,"Content-Type":"application/json"};
  const leaguesResponse=await fetch(`${supabaseUrl}/rest/v1/rpc/my_leagues`,{method:"POST",headers:common,body:"{}",cache:"no-store"});
  const leagues=leaguesResponse.ok?await leaguesResponse.json():[];
  if(!leagues.some((league:{is_commissioner:boolean})=>league.is_commissioner))return NextResponse.json({error:"Commissioner access required."},{status:403});
  const now=new Date(),season=now.getUTCMonth()<6?now.getUTCFullYear()-1:now.getUTCFullYear();
  let imported=0,requestsUsed=0;
  for(const competition of competitions){
    let page=1,total=1;
    while(page<=total){
      const body=await apiFootball<ApiPage>(`players?league=${competition.id}&season=${season}&page=${page}`);requestsUsed++;
      total=body.paging.total;
      const players=body.response.flatMap(entry=>{const stat=entry.statistics[0];if(!stat?.team?.name)return[];return[{apiFootballId:entry.player.id,fullName:entry.player.name,nationality:entry.player.nationality,photoUrl:entry.player.photo??playerHeadshot(entry.player.id),position:stat.games.position??"Attacker",club:stat.team.name,competition:competition.name}]});
      for(let index=0;index<players.length;index+=500){
        const response=await fetch(`${supabaseUrl}/rest/v1/rpc/sync_api_football_players`,{method:"POST",headers:common,body:JSON.stringify({p_players:players.slice(index,index+500)}),cache:"no-store"});
        if(!response.ok)throw new Error((await response.text())||"Player database sync failed");
        imported+=Number(await response.json())||0;
      }
      page++;
    }
  }
  return NextResponse.json({ok:true,season,imported,requestsUsed});
}
