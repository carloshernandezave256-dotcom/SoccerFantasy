import {NextRequest,NextResponse} from 'next/server';
import {LiveScoreStore,type PendingGameweek} from './live-score-store';
import {synchronizeFixtureScores} from './live-score-sync';
import {refreshAffectedLeagueScores} from './live-score-leagues';

const errorMessage=(error:unknown)=>error instanceof Error?error.message:String(error);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function terminalWeek(week:PendingGameweek){
 const proof=week.diagnostics as {fixtures?:Array<{status:string}>};
 return Boolean(proof?.fixtures?.length&&proof.fixtures.every(f=>['FT','AET','PEN','EXCLUDED'].includes(f.status)));
}
function journalSummary(body:Record<string,unknown>){
 const {blockedGameweeks,errors,publicationErrors,...counts}=body;
 return {...counts,
  blockedGameweeks:Array.isArray(blockedGameweeks)?blockedGameweeks.slice(0,10).map(({leagueId,gameweek,fixturesReady})=>({leagueId,gameweek,fixturesReady})):[],
  blockedGameweekCount:Array.isArray(blockedGameweeks)?blockedGameweeks.length:0,
  errors:Array.isArray(errors)?errors.slice(0,10):[],
  errorCount:Array.isArray(errors)?errors.length:0,
  publicationErrors:Array.isArray(publicationErrors)?publicationErrors.slice(0,10):[],
  publicationErrorCount:Array.isArray(publicationErrors)?publicationErrors.length:0};
}

/** A dispatched HTTP request is not a completed run. Persist the actual outcome. */
export async function scoringCron(request:NextRequest,jobName:'scores'|'wrap-gameweeks'){
 if(!process.env.CRON_SECRET||request.headers.get('authorization')!==`Bearer ${process.env.CRON_SECRET}`)
  return NextResponse.json({error:'Unauthorized'},{status:401});
 const requested=request.nextUrl.searchParams.get('fixtureId');
 const fixtureId=requested===null?undefined:Number(requested);
 const requestedRunId=request.nextUrl.searchParams.get('runId')??undefined;
 if(fixtureId!==undefined&&(!Number.isSafeInteger(fixtureId)||fixtureId<=0))
  return NextResponse.json({error:'Invalid fixtureId'},{status:400});
 if(requestedRunId!==undefined&&!uuid.test(requestedRunId))
  return NextResponse.json({error:'Invalid runId'},{status:400});
 const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!key)return NextResponse.json({error:'Server database credential is not configured.'},{status:503});
 const store=new LiveScoreStore(process.env.NEXT_PUBLIC_SUPABASE_URL??'https://ocabrgbrkqmsnalbfzvx.supabase.co',key);
 const now=new Date();
 let runId:string|undefined,claimed=false,status=200;
 let outcome:'completed'|'failed'|'skipped'='failed';
 let body:Record<string,unknown>={ok:false,ranAt:now.toISOString()};
 try{
  runId=await store.startScoringRun(jobName,requestedRunId);
  claimed=await store.claimSync(now);
  if(!claimed){
   outcome='skipped';
   body={ok:true,skipped:true,runId,ranAt:now.toISOString(),reason:'A shared scoring update is running.'};
  }else{
   // Candidate discovery also freezes due membership. Publication does not depend
   // on having any provider candidates or being within a live fixture window.
   const candidates=await store.candidateFixtures(now,fixtureId);
   const before=await store.pendingGameweeks();
   const ready=[...new Set(before.filter(w=>w.fixtures_ready).map(w=>w.league_id))];
   const pre=await refreshAffectedLeagueScores(store,[],now,ready);
   await store.renewSync(now);
   const ingestion=candidates.length?await synchronizeFixtureScores(store,candidates,now,{publish:false,deadline:now.getTime()+210_000}):null;
   await store.renewSync(now);
   const pending=await store.pendingGameweeks();
   // Batch publication once per week, not once for every provider fixture.
   const post=await refreshAffectedLeagueScores(store,candidates.map(f=>f.fixture_id),now,
    [...new Set(pending.filter(w=>w.fixtures_ready).map(w=>w.league_id))]);
   const remaining=await store.pendingGameweeks();
   const blocked=remaining.filter(terminalWeek).map(w=>({leagueId:w.league_id,gameweek:w.gameweek,fixturesReady:w.fixtures_ready,diagnostics:w.diagnostics}));
   const publicationErrors=[...pre.errors,...post.errors];
   const errors=ingestion?.errors??[];
   const ok=errors.length===0&&publicationErrors.length===0&&blocked.length===0;
   outcome=ok?'completed':'failed';status=ok?200:502;
   body={ok,runId,ranAt:now.toISOString(),provider:'sportmonks',requestsUsed:ingestion?.requestsUsed??0,
    fixturesAttempted:candidates.length,sharedPlayerRowsUpdated:ingestion?.sharedPlayerRowsUpdated??0,
    leaguePlayerRowsUpdated:pre.leagueRowsUpdated+post.leagueRowsUpdated,
    fantasyLeagueGameweeksUpdated:pre.leagueGameweeksUpdated+post.leagueGameweeksUpdated,
    pendingGameweeks:remaining.length,blockedGameweeks:blocked,errors,publicationErrors};
  }
 }catch(error){
  status=502;outcome='failed';body={...body,ok:false,runId,error:errorMessage(error)};
 }finally{
  if(claimed){
   try{await store.releaseSync(now)}catch(error){
    status=502;outcome='failed';body={...body,ok:false,releaseError:errorMessage(error)};
   }
  }
  if(runId){
   try{await store.finishScoringRun(runId,outcome,journalSummary(body),typeof body.error==='string'?body.error:undefined)}catch(error){
    status=502;outcome='failed';body={...body,ok:false,trackingError:errorMessage(error)};
   }
  }
 }
 console[status>=400?'error':'info'](`[cron/${jobName}]`,{runId,outcome,status});
 return NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
}
