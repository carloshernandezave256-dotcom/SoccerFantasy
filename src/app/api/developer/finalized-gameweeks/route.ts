import {NextRequest,NextResponse} from "next/server";
import {isDeveloperRequest} from "@/lib/developer-auth";

function config(){
  return{
    url:process.env.NEXT_PUBLIC_SUPABASE_URL??"https://ocabrgbrkqmsnalbfzvx.supabase.co",
    serviceKey:process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
}

export async function GET(request:NextRequest){
  if(!await isDeveloperRequest(request))return NextResponse.json({error:"Developer access required."},{status:403});
  const leagueId=request.nextUrl.searchParams.get("leagueId");
  if(!leagueId)return NextResponse.json({error:"Choose a league first."},{status:400});
  const{url,serviceKey}=config();
  if(!serviceKey)return NextResponse.json({error:"Server database credential is not configured."},{status:503});
  const response=await fetch(`${url}/rest/v1/finalized_gameweek_locks?league_id=eq.${encodeURIComponent(leagueId)}&select=gameweek,locked_at,correction_expires_at,correction_reason&order=gameweek.desc`,{headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`},cache:"no-store"});
  if(!response.ok)return NextResponse.json({error:(await response.text())||"Could not read finalized gameweeks."},{status:502});
  return NextResponse.json({locks:await response.json()});
}

export async function POST(request:NextRequest){
  if(!await isDeveloperRequest(request))return NextResponse.json({error:"Developer access required."},{status:403});
  const authorization=request.headers.get("authorization")??"";
  const body=await request.json().catch(()=>({})) as {leagueId?:string;gameweek?:number;action?:"lock"|"unlock"|"relock"|"restore";reason?:string};
  if(!body.leagueId||!body.gameweek||!body.action)return NextResponse.json({error:"League, gameweek, and action are required."},{status:400});
  if((body.action==="unlock"||body.action==="restore")&&!body.reason?.trim())return NextResponse.json({error:"A correction reason is required."},{status:400});
  const{url}=config();
  const publishableKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY??"sb_publishable_DA08c5KwmYXpru6CdrRfHA_4Qe2z3M-";
  const response=await fetch(`${url}/rest/v1/rpc/developer_finalized_gameweek_action`,{method:"POST",headers:{apikey:publishableKey,Authorization:authorization,"Content-Type":"application/json"},body:JSON.stringify({p_league_id:body.leagueId,p_gameweek:body.gameweek,p_action:body.action,p_reason:body.reason??null}),cache:"no-store"});
  const result=await response.json().catch(()=>null);
  if(!response.ok)return NextResponse.json({error:result?.message??result?.error??"Finalized-gameweek action failed."},{status:response.status});
  return NextResponse.json({lock:result});
}
