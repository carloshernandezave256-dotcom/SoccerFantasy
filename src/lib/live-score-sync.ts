import {type CachedFixture,reconcileFixtureStatus} from './live-score-domain';
import {refreshAffectedLeagueScores} from './live-score-leagues';
import {LiveScoreStore} from './live-score-store';
import {normalizeSportMonks} from './sportmonks-scoring';
import {sportmonks} from './sportmonks-server';
import {adminDb,checked,fixtureInclude,fixtureSides,fixtureStatus,kickoff,profileMap,type SMFixture,type SMTeam} from './sportmonks-data';

/** SportMonks is the sole scoring provider. Canonical fixture/player IDs never change. */
export async function synchronizeFixtureScores(store:LiveScoreStore,candidates:CachedFixture[],now:Date){
 const db=adminDb(),ranAt=now.toISOString();let requestsUsed=0,sharedPlayerRowsUpdated=0,injuriesCleared=0,clubsUpdated=0,eventFixturesSynced=0;
 const teams=await checked(db.from('sportmonks_teams').select('*')) as SMTeam[];
 const contexts=await checked(db.from('football_fixture_cache').select('*').in('fixture_id',candidates.map(f=>f.fixture_id)));
 const prior=await store.priorProviderStatuses(candidates.map(f=>f.fixture_id),now);
 const touched:number[]=[],errors:Array<{fixtureId:number;error:string}>=[];
 for(const context of contexts){
  const id=context.fixture_id;
  await store.renewSync(now);
  try{
   await store.recordFixtureEvidence(id,ranAt,false,'SportMonks refresh in progress',[]);
   if(!context.sportmonks_id)throw new Error('Fixture has no verified SportMonks mapping; synchronize schedules.');
   const response=await sportmonks(`fixtures/${context.sportmonks_id}`,{include:fixtureInclude});requestsUsed++;
   const f=response.data as SMFixture;
   if(f.id!==context.sportmonks_id)throw new Error('SportMonks fixture identity mismatch');
   const sides=fixtureSides(f),rawStatus=fixtureStatus(f);
   const home=teams.find(t=>t.sportmonks_id===sides.home.id),away=teams.find(t=>t.sportmonks_id===sides.away.id);
   if(home?.club!==context.home_team||away?.club!==context.away_team)throw new Error('SportMonks fixture participants mismatch');
   const status=reconcileFixtureStatus(rawStatus,context.status,prior.get(id));
   await store.updateFixtureState({fixture:{id,date:kickoff(f.starting_at),status:{short:status}},league:{id:context.competition_id,name:context.competition},teams:{home:{id:sides.home.id},away:{id:sides.away.id}},goals:{home:sides.homeScore,away:sides.awayScore}},status,ranAt);
   touched.push(id);
   if(['NS','TBD','PST','CANC','ABD','AWD','WO'].includes(rawStatus))continue;
   if(!Array.isArray(f.lineups)||!f.lineups.length)throw new Error('SportMonks lineup statistics not yet available');
   const playerMap=await profileMap(f,teams);
   const source={fixture_id:id,sportmonks_id:f.id,raw_data:f,player_map:playerMap};
   await checked(db.from('sportmonks_fixture_sources').upsert({...source,captured_at:ranAt},{onConflict:'fixture_id'}));
   if(sides.homeScore===null||sides.awayScore===null)throw new Error('SportMonks current score is missing');
   const rows=normalizeSportMonks(source,{fixture_id:id,kickoff:kickoff(f.starting_at),competition_id:context.competition_id,home_score:sides.homeScore,away_score:sides.awayScore},ranAt,{live:true});
   await store.upsertFixtureStats(rows,ranAt);sharedPlayerRowsUpdated+=rows.length;
   const final=['FT','AET','PEN'].includes(rawStatus)&&['FT','AET','PEN'].includes(status);
   if(final){await store.markFixtureEventsSynced([id],ranAt);eventFixturesSynced++;}
   await store.insertObservations([{fixture_id:id,observed_at:ranAt,status:rawStatus,home_score:sides.homeScore,away_score:sides.awayScore,provider_player_rows:f.lineups.length,mapped_player_rows:rows.length,unmapped_players:[]}]);
   await store.recordFixtureEvidence(id,ranAt,final,final?'SportMonks lineup, minutes and events reconciled':'SportMonks live statistics; final proof pending',rows.map(r=>r.player_id));
   await checked(db.from('sportmonks_fixture_sources').update({imported_at:ranAt}).eq('fixture_id',id));
   const appeared=rows.filter(r=>Number(r.minutes)>0);
   injuriesCleared+=await store.reconcilePlayerAvailability(appeared.map(r=>({player_id:r.player_id,kickoff:kickoff(f.starting_at)})));
   clubsUpdated+=await store.reconcilePlayerClubs(appeared.map(r=>{
    const l=f.lineups.find(l=>playerMap[l.player_id]===r.player_id)!;const t=teams.find(t=>t.sportmonks_id===l.team_id)!;
    return {fixture_id:id,player_id:r.player_id,club:t.club,competition:t.competition,kickoff:kickoff(f.starting_at),observed_at:ranAt};
   }));
  }catch(error){
   const message=error instanceof Error?error.message:String(error);
   await store.recordFixtureEvidence(id,ranAt,false,message,[]);
   errors.push({fixtureId:id,error:message});
  }
 }
 const summary=await refreshAffectedLeagueScores(store,touched,now);
 return {ok:errors.length===0,provider:'sportmonks',ranAt,requestsUsed,fixturesEligible:candidates.length,fixturesLive:touched.length,sharedPlayerRowsUpdated,fantasyLeagueGameweeksUpdated:summary.leagueGameweeksUpdated,leaguePlayerRowsUpdated:summary.leagueRowsUpdated,injuriesCleared,clubsUpdated,eventFixturesSynced,errors};
}
