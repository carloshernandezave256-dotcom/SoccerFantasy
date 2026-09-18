import {NextRequest,NextResponse} from 'next/server';
import {allPages,competitions,fixtureInclude,type SMFixture} from '@/lib/sportmonks-data';
import {previewDetails} from '@/lib/sportmonks-preview';
export const maxDuration=300;
export async function GET(request:NextRequest){
  const supabaseUrl=process.env.NEXT_PUBLIC_SUPABASE_URL??"https://ocabrgbrkqmsnalbfzvx.supabase.co";
  const publishableKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY??"sb_publishable_DA08c5KwmYXpru6CdrRfHA_4Qe2z3M-";
  const authorization=request.headers.get("authorization")??"";
  if(!authorization.startsWith("Bearer "))return NextResponse.json({error:"Sign in is required."},{status:401});
  const userResponse=await fetch(`${supabaseUrl}/auth/v1/user`,{headers:{apikey:publishableKey,Authorization:authorization},cache:"no-store"});
  if(!userResponse.ok)return NextResponse.json({error:"Your session has expired."},{status:401});

  const leaguesResponse=await fetch(`${supabaseUrl}/rest/v1/rpc/my_leagues`,{method:"POST",headers:{apikey:publishableKey,Authorization:authorization,"Content-Type":"application/json"},body:"{}",cache:"no-store"});
  const leagues=leaguesResponse.ok?await leaguesResponse.json():[];
  const leagueId=request.nextUrl.searchParams.get("league");
  if(!leagues.some((league:{league_id:string;is_commissioner:boolean})=>league.league_id===leagueId&&league.is_commissioner))return NextResponse.json({error:"Only this league’s commissioner can run an API test."},{status:403});
  const date=request.nextUrl.searchParams.get("date")??new Intl.DateTimeFormat("en-CA",{timeZone:"America/Los_Angeles",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());

 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return NextResponse.json({error:'Use YYYY-MM-DD.'},{status:400});
 try{
  const result=await allPages<SMFixture>(`fixtures/date/${date}`,{include:fixtureInclude});
  const details=result.rows.filter(f=>competitions.some(c=>c.id===f.league_id)).map(previewDetails);
  return NextResponse.json({date,provider:'sportmonks',requestsUsed:result.requestsUsed,fixtures:details.map(f=>({id:f.matchId,competition:f.league,match:`${f.home} vs ${f.away}`,status:f.status})),players:details.flatMap(f=>f.players.map(p=>({...p.stats,apiPlayerId:p.providerId,provider:'sportmonks',name:p.name,club:p.team,competition:f.league,fixtureId:f.matchId,fixture:`${f.home} vs ${f.away}`,kickoff:f.kickoff,status:f.status}))),notes:['Statistics supplied by SportMonks; points use the league scoring rules.']});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'SportMonks request failed.'},{status:502});}
}
