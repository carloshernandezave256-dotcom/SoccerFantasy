import {NextRequest,NextResponse} from "next/server";

type League={id:string;name:string};
type SyncResult={leagueId:string;leagueName:string;ok:boolean;gameweek?:number;playersUpdated?:number;matchupsUpdated?:number;requestsUsed?:number;error?:string};

export const dynamic="force-dynamic";
export const maxDuration=300;

function adminHeaders(key:string){return{apikey:key,Authorization:`Bearer ${key}`}}

export async function GET(request:NextRequest){
  const secret=process.env.CRON_SECRET;
  if(!secret)return NextResponse.json({error:"CRON_SECRET is not configured."},{status:503});
  if(request.headers.get("authorization")!==`Bearer ${secret}`)return NextResponse.json({error:"Unauthorized"},{status:401});

  const supabaseUrl=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!supabaseUrl||!serviceRoleKey)return NextResponse.json({error:"Server database credentials are not configured."},{status:503});

  const leaguesResponse=await fetch(`${supabaseUrl}/rest/v1/leagues?select=id,name&game_format=in.(draft,auction)&calendar_competition=not.is.null`,{headers:adminHeaders(serviceRoleKey),cache:"no-store"});
  if(!leaguesResponse.ok)return NextResponse.json({error:(await leaguesResponse.text())||"Could not load leagues."},{status:502});
  const leagues=await leaguesResponse.json() as League[];
  const results:SyncResult[]=[];

  // Small batches keep API-Football concurrency predictable while allowing every
  // beta league to finish inside the serverless execution window.
  for(let index=0;index<leagues.length;index+=2){
    const batch=leagues.slice(index,index+2);
    results.push(...await Promise.all(batch.map(async league=>{
      try{
        const response=await fetch(new URL("/api/football/sync/scores",request.url),{method:"POST",headers:{Authorization:`Bearer ${secret}`,"Content-Type":"application/json"},body:JSON.stringify({leagueId:league.id}),cache:"no-store"});
        const body=await response.json().catch(()=>({error:"Score synchronization returned an invalid response."}));
        return response.ok?{leagueId:league.id,leagueName:league.name,ok:true,gameweek:body.gameweek,playersUpdated:body.playersUpdated,matchupsUpdated:body.matchupsUpdated,requestsUsed:body.requestsUsed}:{leagueId:league.id,leagueName:league.name,ok:false,error:body.error??`Score synchronization returned ${response.status}.`};
      }catch(error){return{leagueId:league.id,leagueName:league.name,ok:false,error:error instanceof Error?error.message:"Score synchronization failed."}}
    })));
  }

  const failed=results.filter(result=>!result.ok);
  return NextResponse.json({ok:failed.length===0,ranAt:new Date().toISOString(),leaguesFound:leagues.length,leaguesUpdated:results.length-failed.length,failed:failed.length,requestsUsed:results.reduce((total,result)=>total+(result.requestsUsed??0),0),results},{status:failed.length===results.length&&results.length>0?502:200});
}
