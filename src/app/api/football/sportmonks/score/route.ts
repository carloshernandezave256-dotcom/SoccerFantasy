import {NextRequest,NextResponse} from 'next/server';
import {createClient} from '@supabase/supabase-js';
import {isDeveloperRequest} from '@/lib/developer-auth';
import {LiveScoreStore} from '@/lib/live-score-store';
import {refreshAffectedLeagueScores} from '@/lib/live-score-leagues';
import {normalizeSportMonks,type SportMonksSource,type FixtureContext} from '@/lib/sportmonks-scoring';
export const dynamic='force-dynamic';
export const maxDuration=300;
export async function POST(request:NextRequest){
 const cron=Boolean(process.env.CRON_SECRET)&&request.headers.get('authorization')===`Bearer ${process.env.CRON_SECRET}`;
 if(!cron&&!await isDeveloperRequest(request))return NextResponse.json({error:'Developer access required.'},{status:403});
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL;const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)return NextResponse.json({error:'Server database credential missing.'},{status:503});
 try{
  const body=await request.json();
  const ids=body.fixtureIds;
  if(!Array.isArray(ids)||!ids.length||ids.length>48||ids.some(id=>!Number.isSafeInteger(id)||id<=0)||new Set(ids).size!==ids.length)
   return NextResponse.json({error:'Supply 1–48 distinct fixture IDs.'},{status:400});
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const [{data:sources,error:se},{data:contexts,error:ce}]=await Promise.all([
   db.from('sportmonks_fixture_sources').select('*').in('fixture_id',ids),
   db.from('football_fixture_cache').select('fixture_id,kickoff,competition_id,home_score,away_score').in('fixture_id',ids),
  ]);
  if(se||ce)throw new Error('Could not read saved SportMonks sources.');
  if(sources?.length!==ids.length||contexts?.length!==ids.length)throw new Error('A reviewed fixture source is missing.');
  const now=new Date();const ranAt=now.toISOString();
  // Validate the entire requested batch before any scoring writes.
  const plans=(sources as SportMonksSource[]).map(source=>({source,rows:normalizeSportMonks(source,contexts.find(c=>c.fixture_id===source.fixture_id) as FixtureContext,ranAt)}));
  const summary=plans.map(p=>({fixtureId:p.source.fixture_id,players:p.rows.length,appeared:p.rows.filter(r=>Number(r.minutes)>0).length}));
  if(body.apply!==true)return NextResponse.json({ok:true,dryRun:true,fixtures:summary});
  const store=new LiveScoreStore(url,key);
  if(!await store.claimSync(now))return NextResponse.json({error:'A score synchronization is running; retry shortly.'},{status:409});
  try{
  for(const {source,rows} of plans){
   const lease=await db.from("football_sync_state").update({live_claimed_until:new Date(Date.now()+105000).toISOString()}).eq("singleton_id",1).eq("updated_at",ranAt).select("singleton_id");
   if(lease.error||lease.data?.length!==1)throw new Error("Scoring synchronization lease lost.");
   await store.recordFixtureEvidence(source.fixture_id,ranAt,false,'SportMonks verified source import in progress',[]);
   await store.upsertFixtureStats(rows,ranAt);
   await store.markFixtureEventsSynced([source.fixture_id],ranAt);
   await store.recordFixtureEvidence(source.fixture_id,ranAt,true,'SportMonks: reviewed identities, full squads, minutes, scoring stats and final events reconciled',rows.map(r=>r.player_id));
   const {error}=await db.from('sportmonks_fixture_sources').update({imported_at:ranAt}).eq('fixture_id',source.fixture_id);
   if(error)throw new Error('Could not record SportMonks import completion.');
  }
  const refreshed=await refreshAffectedLeagueScores(store,ids,now);
  return NextResponse.json({ok:true,dryRun:false,fixtures:summary,...refreshed});
  }finally{await db.from("football_sync_state").update({live_claimed_until:new Date().toISOString()}).eq("singleton_id",1).eq("updated_at",ranAt);}
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'SportMonks scoring import failed.'},{status:422});}
}
