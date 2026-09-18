import {NextRequest,NextResponse} from 'next/server';
import {isDeveloperRequest} from '@/lib/developer-auth';
export const dynamic='force-dynamic';
export async function GET(request:NextRequest){
 if(!await isDeveloperRequest(request))return NextResponse.json({error:'Developer access required.'},{status:403});
 const leagueId=request.nextUrl.searchParams.get('leagueId')??'';
 const gameweek=Number(request.nextUrl.searchParams.get('gameweek'));
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(leagueId)||!Number.isInteger(gameweek)||gameweek<1||gameweek>32767)
  return NextResponse.json({error:'Valid leagueId and gameweek required.'},{status:400});
 const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!key)return NextResponse.json({error:'Server database credential is not configured.'},{status:503});
 try{
  const response=await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL??'https://ocabrgbrkqmsnalbfzvx.supabase.co'}/rest/v1/rpc/gameweek_reconciliation_status`,{
   method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
   body:JSON.stringify({p_league_id:leagueId,p_gameweek:gameweek}),cache:'no-store'});
  if(!response.ok)throw new Error('Could not read gameweek reconciliation status.');
  return NextResponse.json(await response.json());
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:String(error)},{status:502});}
}
