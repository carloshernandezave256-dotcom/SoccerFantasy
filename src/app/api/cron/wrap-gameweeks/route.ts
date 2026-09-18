import {NextRequest,NextResponse} from 'next/server';
import {LiveScoreStore} from '@/lib/live-score-store';
import {synchronizeFixtureScores} from '@/lib/live-score-sync';
import {refreshAffectedLeagueScores} from '@/lib/live-score-leagues';
export const dynamic='force-dynamic';
export const maxDuration=300;
export async function GET(request:NextRequest){
 if(!process.env.CRON_SECRET||request.headers.get('authorization')!==`Bearer ${process.env.CRON_SECRET}`)
  return NextResponse.json({error:'Unauthorized'},{status:401});
 const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!key)return NextResponse.json({error:'Server database credential is not configured.'},{status:503});
 const store=new LiveScoreStore(process.env.NEXT_PUBLIC_SUPABASE_URL??'https://ocabrgbrkqmsnalbfzvx.supabase.co',key);
 const now=new Date();
 try{
  if(!await store.claimSync(now))return NextResponse.json({ok:true,reason:'A shared scoring update is running.'});
  const leagues=await store.excludedScoringLeagueIds();
  await refreshAffectedLeagueScores(store,[],now,leagues);
  const requested=request.nextUrl.searchParams.get('fixtureId');
  const fixtureId=requested===null?undefined:Number(requested);
  if(fixtureId!==undefined && (!Number.isSafeInteger(fixtureId)||fixtureId<=0))
    return NextResponse.json({error:'Invalid fixtureId'},{status:400});
  const candidates=await store.candidateFixtures(now,fixtureId);
  const results=[];const errors=[];
  // Isolate fixture/provider failures so one cannot starve every following retry.
  for(const fixture of candidates){
   try{results.push(await synchronizeFixtureScores(store,[fixture],now));}
   catch(error){errors.push({fixtureId:fixture.fixture_id,error:error instanceof Error?error.message:String(error)});}
  }
  console[errors.length?'error':'info']('[cron/wrap-gameweeks]',{ranAt:now.toISOString(),attempted:candidates.length,errors});
  return NextResponse.json({ok:errors.length===0,ranAt:now.toISOString(),results,errors},{status:errors.length?502:200});
 }catch(error){
  console.error('[cron/wrap-gameweeks]',error);
  return NextResponse.json({error:error instanceof Error?error.message:String(error)},{status:502});
 }finally{await store.releaseSync(now)}
}
