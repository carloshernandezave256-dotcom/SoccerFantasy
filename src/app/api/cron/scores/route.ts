import {NextRequest,NextResponse} from "next/server";

type League={id:string;name:string;calendar_competition:string};
type FixtureWindow={kickoff:string;status:string};
type SyncResult={leagueId:string;leagueName:string;ok:boolean;gameweek?:number;playersUpdated?:number;matchupsUpdated?:number;requestsUsed?:number;error?:string};

export const dynamic="force-dynamic";
export const maxDuration=300;

function adminHeaders(key:string){return{apikey:key,Authorization:`Bearer ${key}`}}

export async function GET(request:NextRequest){
  const secret=process.env.CRON_SECRET;
  if(!secret)return NextResponse.json({error:"CRON_SECRET is not configured."},{status:503});
  if(request.headers.get("authorization")!==`Bearer ${secret}`)return NextResponse.json({error:"Unauthorized"},{status:401});

  const supabaseUrl=process.env.NEXT_PUBLIC_SUPABASE_URL??"https://ocabrgbrkqmsnalbfzvx.supabase.co";
  const serviceRoleKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!serviceRoleKey)return NextResponse.json({error:"Server database credential is not configured."},{status:503});

  const leaguesResponse=await fetch(`${supabaseUrl}/rest/v1/leagues?select=id,name,calendar_competition&game_format=in.(draft,auction,pack)&calendar_competition=not.is.null`,{headers:adminHeaders(serviceRoleKey),cache:"no-store"});
  if(!leaguesResponse.ok)return NextResponse.json({error:(await leaguesResponse.text())||"Could not load leagues."},{status:502});
  const leagues=await leaguesResponse.json() as League[];
  const calendarRefreshes=await Promise.all(leagues.map(async league=>{
    const response=await fetch(`${supabaseUrl}/rest/v1/rpc/refresh_league_calendar`,{method:"POST",headers:{...adminHeaders(serviceRoleKey),"Content-Type":"application/json"},body:JSON.stringify({p_league_id:league.id}),cache:"no-store"});
    return {leagueId:league.id,ok:response.ok};
  }));
  const now=new Date();
  const activeSince=new Date(now.getTime()-6*60*60*1000);
  const finalStatuses=new Set(["FT","AET","PEN","PST","CANC","ABD","AWD","WO"]);
  const activity=await Promise.all(leagues.map(async league=>{
    const query=new URLSearchParams({
      league_id:`eq.${league.id}`,
      competition:`eq.${league.calendar_competition}`,
      kickoff:`lte.${now.toISOString()}`,
      select:"kickoff,status",
      order:"kickoff.desc",
      limit:"1",
    });
    const response=await fetch(`${supabaseUrl}/rest/v1/league_headline_fixtures?${query}`,{headers:adminHeaders(serviceRoleKey),cache:"no-store"});
    const fixtures=response.ok?await response.json() as FixtureWindow[]:[];
    const latest=fixtures[0];
    // No cached fixture means the league needs one bootstrap sync. Otherwise only
    // spend API-Football requests while its calendar competition can be live.
    return {league,shouldSync:!latest||(new Date(latest.kickoff)>=activeSince&&!finalStatuses.has(latest.status))};
  }));
  const activeLeagues=activity.filter(item=>item.shouldSync).map(item=>item.league);
  const results:SyncResult[]=[];

  // Small batches keep API-Football concurrency predictable while allowing every
  // beta league to finish inside the serverless execution window.
  for(let index=0;index<activeLeagues.length;index+=2){
    const batch=activeLeagues.slice(index,index+2);
    results.push(...await Promise.all(batch.map(async league=>{
      try{
        const response=await fetch(new URL("/api/football/sync/scores",request.url),{method:"POST",headers:{Authorization:`Bearer ${secret}`,"Content-Type":"application/json"},body:JSON.stringify({leagueId:league.id}),cache:"no-store"});
        const body=await response.json().catch(()=>({error:"Score synchronization returned an invalid response."}));
        return response.ok?{leagueId:league.id,leagueName:league.name,ok:true,gameweek:body.gameweek,playersUpdated:body.playersUpdated,matchupsUpdated:body.matchupsUpdated,requestsUsed:body.requestsUsed}:{leagueId:league.id,leagueName:league.name,ok:false,error:body.error??`Score synchronization returned ${response.status}.`};
      }catch(error){return{leagueId:league.id,leagueName:league.name,ok:false,error:error instanceof Error?error.message:"Score synchronization failed."}}
    })));
  }

  const failed=results.filter(result=>!result.ok);
  return NextResponse.json({ok:failed.length===0,ranAt:new Date().toISOString(),cadenceMinutes:3,leaguesFound:leagues.length,calendarsRefreshed:calendarRefreshes.filter(item=>item.ok).length,calendarRefreshFailures:calendarRefreshes.filter(item=>!item.ok).length,leaguesEligible:activeLeagues.length,leaguesSkipped:leagues.length-activeLeagues.length,leaguesUpdated:results.length-failed.length,failed:failed.length,requestsUsed:results.reduce((total,result)=>total+(result.requestsUsed??0),0),results},{status:failed.length===results.length&&results.length>0?502:200});
}
