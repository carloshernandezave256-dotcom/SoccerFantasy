import {NextRequest,NextResponse} from 'next/server';
import {providerAuthorized} from '@/lib/sportmonks-route';
import {doubtfulLeagues,fetchDoubtfulLeague} from '@/lib/fotmob-doubtful';
export const dynamic='force-dynamic';
export const maxDuration=180;
export async function POST(request:NextRequest){
 if(!await providerAuthorized(request))return NextResponse.json({error:'Developer access required.'},{status:403});
 const body=await request.json().catch(()=>null);
 if(!doubtfulLeagues.some(l=>l.id===body?.leagueId))return NextResponse.json({error:'Choose one of the five supported leagues.'},{status:400});
 try{return NextResponse.json(await fetchDoubtfulLeague(body.leagueId),{headers:{'Cache-Control':'private, no-store'}});}
 catch(error){return NextResponse.json({error:error instanceof Error?error.message:'FotMob check failed.'},{status:502});}
}
