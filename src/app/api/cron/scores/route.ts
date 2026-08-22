import {NextRequest,NextResponse} from "next/server";
import {apiFootball} from "@/lib/api-football-server";
import {selectManOfTheMatchId} from "@/lib/match-awards";
import {completedPassesFromApi} from "@/lib/api-football-stats";
import {resolvePlayerScoreStatus} from "@/lib/scoring";

const terminal=new Set(["FT","AET","PEN","PST","CANC","ABD","AWD","WO"]);
type CachedFixture={fixture_id:number;status:string;kickoff:string};
type LiveFixture={fixture:{id:number;date:string;status:{short:string}};teams:{home:{id:number};away:{id:number}};goals:{home:number|null;away:number|null}};
type LivePage={response:LiveFixture[]};
type ApiPlayer={player:{id:number};statistics:Array<{games:{minutes:number|null;rating:string|null};shots:{on:number|null};goals:{total:number|null;assists:number|null;conceded:number|null;saves:number|null};passes:{total:number|null;accuracy:number|string|null};tackles:{total:number|null};cards:{yellow:number|null;red:number|null};penalty:{scored:number|null;missed:number|null;saved:number|null;commited:number|null}}>};
type PlayersPage={response:Array<{team:{id:number};players:ApiPlayer[]}>};
type FixtureDetail=LiveFixture&{players?:PlayersPage["response"]};
type FixtureDetailPage={response:FixtureDetail[]};
type Player={id:number;api_football_id:number|null};
type LeagueFixture={league_id:string;fixture_id:number};
type LeagueRow={calendar_competition:string;player_pool:string};
type WindowRow={gameweek:number;roster_lock_at:string};
type WeekFixture={fixture_id:number;status:string;kickoff:string};
type StatRow=Record<string,number|boolean|null|string> & {fixture_id:number;player_id:number};

export const dynamic="force-dynamic";
export const maxDuration=300;
function headers(key:string){return{apikey:key,Authorization:`Bearer ${key}`,"Content-Type":"application/json"}}
function sum(rows:StatRow[],field:string){return rows.reduce((total,row)=>total+Number(row[field]??0),0)}

export async function GET(request:NextRequest){
  const secret=process.env.CRON_SECRET;
  if(!secret||request.headers.get("authorization")!==`Bearer ${secret}`)return NextResponse.json({error:"Unauthorized"},{status:401});
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL??"https://ocabrgbrkqmsnalbfzvx.supabase.co";
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!key)return NextResponse.json({error:"Server database credential is not configured."},{status:503});
  const now=new Date();
  // Keep the overlap guard shorter than the two-minute scheduler cadence so
  // every scheduled run can execute while a genuinely stuck run still expires.
  const claim=await fetch(`${url}/rest/v1/football_sync_state?singleton_id=eq.1&live_claimed_until=lt.${now.toISOString()}`,{method:"PATCH",headers:{...headers(key),Prefer:"return=representation"},body:JSON.stringify({live_claimed_until:new Date(now.getTime()+105000).toISOString(),updated_at:now.toISOString()}),cache:"no-store"});
  if(!claim.ok)return NextResponse.json({error:(await claim.text())||"Could not claim the shared synchronization lock."},{status:502});
  const claimed=await claim.json() as Array<{singleton_id:number}>;
  if(!claimed.length)return NextResponse.json({ok:true,ranAt:now.toISOString(),requestsUsed:0,reason:"A shared live-score synchronization is already running."});
  const windowStart=new Date(now.getTime()-4*60*60*1000).toISOString();
  // Poll every cached Top-5 fixture for four full hours after kickoff,
  // regardless of status. Fixture status and player statistics can settle at
  // different times, so FT must never stop the player-stat refresh early.
  const query=new URLSearchParams({select:"fixture_id,status,kickoff",and:`(kickoff.gte.${windowStart},kickoff.lte.${now.toISOString()})`});
  const candidatesResponse=await fetch(`${url}/rest/v1/football_fixture_cache?${query}`,{headers:headers(key),cache:"no-store"});
  if(!candidatesResponse.ok)return NextResponse.json({error:(await candidatesResponse.text())||"Could not read the fixture cache."},{status:502});
  const candidates=await candidatesResponse.json() as CachedFixture[];
  if(!candidates.length)return NextResponse.json({ok:true,ranAt:now.toISOString(),requestsUsed:0,reason:"No cached fixture is inside a possible live-match window."});

  try{
    const live=await apiFootball<LivePage>("fixtures?live=all");
    let requestsUsed=1;
    const candidateIds=new Set(candidates.map(item=>item.fixture_id));
    const liveFixtures=live.response.filter(item=>candidateIds.has(item.fixture.id));
    const liveIds=new Set(liveFixtures.map(item=>item.fixture.id));

    // A completed match disappears from fixtures?live=all. Query each dropped
    // candidate once more so its final status, final minutes and player stats
    // do not remain frozen at the last live poll (for example, 83 minutes).
    const droppedCandidates=candidates.filter(item=>!liveIds.has(item.fixture_id));
    const droppedPages=await Promise.all(droppedCandidates.map(async candidate=>{
      const body=await apiFootball<FixtureDetailPage>(`fixtures?id=${candidate.fixture_id}`);
      return body.response[0]??null;
    }));
    requestsUsed+=droppedPages.length;
    // Some competitions can be missing from `fixtures?live=all` even though an
    // individual fixture lookup reports that the match is in progress. Keep
    // every successfully recovered candidate, not only newly final matches, so
    // those leagues still receive live player statistics.
    const recoveredPages=droppedPages.filter((item):item is FixtureDetail=>item!==null);
    const fixtures=[...liveFixtures,...recoveredPages];
    if(!fixtures.length)return NextResponse.json({ok:true,ranAt:now.toISOString(),requestsUsed,fixturesEligible:candidates.length,fixturesLive:0,reason:"Cached fixtures were near kickoff, but none is live or newly final at the provider."});
    const fixtureIds=fixtures.map(item=>item.fixture.id);
    const confirmationWindowStart=new Date(now.getTime()-10*60*1000).toISOString();
    const priorObservationsResponse=await fetch(`${url}/rest/v1/football_fixture_sync_observations?fixture_id=in.(${fixtureIds.join(",")})&observed_at=gte.${confirmationWindowStart}&select=fixture_id,status,observed_at&order=observed_at.desc`,{headers:headers(key),cache:"no-store"});
    const priorObservations=priorObservationsResponse.ok?await priorObservationsResponse.json() as Array<{fixture_id:number;status:string}>:[];
    const priorStatusByFixture=new Map<number,string>();
    for(const observation of priorObservations)if(!priorStatusByFixture.has(observation.fixture_id))priorStatusByFixture.set(observation.fixture_id,observation.status);
    const cachedByFixture=new Map(candidates.map(candidate=>[candidate.fixture_id,candidate]));

    const fixtureUpdates=await Promise.all(fixtures.map(async item=>{
      const providerStatus=item.fixture.status.short;
      const priorStatus=priorStatusByFixture.get(item.fixture.id);
      const terminalConfirmed=!terminal.has(providerStatus)||Boolean(priorStatus&&terminal.has(priorStatus));
      const status=terminalConfirmed?providerStatus:cachedByFixture.get(item.fixture.id)?.status??providerStatus;
      const values={status,kickoff:item.fixture.date,home_score:item.goals.home,away_score:item.goals.away,updated_at:now.toISOString()};
      const [canonical,leagueCopies]=await Promise.all([
        fetch(`${url}/rest/v1/football_fixture_cache?fixture_id=eq.${item.fixture.id}`,{method:"PATCH",headers:{...headers(key),Prefer:"return=minimal"},body:JSON.stringify(values),cache:"no-store"}),
        fetch(`${url}/rest/v1/league_headline_fixtures?fixture_id=eq.${item.fixture.id}`,{method:"PATCH",headers:{...headers(key),Prefer:"return=minimal"},body:JSON.stringify(values),cache:"no-store"}),
      ]);
      return canonical.ok&&leagueCopies.ok;
    }));
    if(fixtureUpdates.some(ok=>!ok))throw new Error("Fixture status update failed");

    // Always use the dedicated player-stat endpoint. Some competitions return
    // player shells from the fixture endpoint with empty statistics arrays.
    const livePages=await Promise.all(liveFixtures.map(async fixture=>{
      const body=await apiFootball<PlayersPage>(`fixtures/players?fixture=${fixture.fixture.id}`);
      return{fixture,teams:body.response};
    }));
    requestsUsed+=livePages.length;
    const recoveredPlayerPages=await Promise.all(recoveredPages.map(async fixture=>{
      const body=await apiFootball<PlayersPage>(`fixtures/players?fixture=${fixture.fixture.id}`);
      requestsUsed+=1;
      return{fixture,teams:body.response};
    }));
    const pages=[...livePages,...recoveredPlayerPages];
    const apiIds=[...new Set(pages.flatMap(({teams})=>teams.flatMap(team=>team.players.map(entry=>entry.player.id))))];
    const playersResponse=apiIds.length?await fetch(`${url}/rest/v1/players?api_football_id=in.(${apiIds.join(",")})&select=id,api_football_id`,{headers:headers(key),cache:"no-store"}):null;
    const players=playersResponse?.ok?await playersResponse.json() as Player[]:[];
    const internalByApi=new Map(players.map(player=>[player.api_football_id,player.id]));
    const cachedStats:StatRow[]=[];
    const providerRowsByFixture=new Map<number,number>();
    const mappedRowsByFixture=new Map<number,number>();
    for(const {fixture,teams} of pages){
      const entries=teams.flatMap(team=>team.players.flatMap(entry=>entry.statistics.slice(0,1).map(stat=>({entry,stat,teamId:team.team.id}))));
      providerRowsByFixture.set(fixture.fixture.id,entries.length);
      for(const {entry,stat,teamId} of entries){
        const playerId=internalByApi.get(entry.player.id);if(!playerId)continue;
        const teamGoalsConceded=teamId===fixture.teams.home.id?fixture.goals.away:teamId===fixture.teams.away.id?fixture.goals.home:null;
        cachedStats.push({fixture_id:fixture.fixture.id,player_id:playerId,rating:Number(stat.games.rating)||null,minutes:stat.games.minutes??0,goals:stat.goals.total??0,assists:stat.goals.assists??0,shots_on_target:stat.shots.on??0,completed_passes:completedPassesFromApi(stat.passes.total,stat.passes.accuracy),tackles_won:stat.tackles.total??0,penalty_goals:stat.penalty.scored??0,penalties_missed:stat.penalty.missed??0,penalties_conceded:stat.penalty.commited??0,saves:stat.goals.saves??0,penalties_saved:stat.penalty.saved??0,goals_conceded:teamGoalsConceded??stat.goals.conceded??0,yellow_cards:stat.cards.yellow??0,red_cards:stat.cards.red??0,man_of_the_match:false,source_updated_at:now.toISOString()});
        mappedRowsByFixture.set(fixture.fixture.id,(mappedRowsByFixture.get(fixture.fixture.id)??0)+1);
      }
    }
    await fetch(`${url}/rest/v1/football_fixture_sync_observations`,{method:"POST",headers:{...headers(key),Prefer:"return=minimal"},body:JSON.stringify(fixtures.map(fixture=>({fixture_id:fixture.fixture.id,observed_at:now.toISOString(),status:fixture.fixture.status.short,home_score:fixture.goals.home,away_score:fixture.goals.away,provider_player_rows:providerRowsByFixture.get(fixture.fixture.id)??0,mapped_player_rows:mappedRowsByFixture.get(fixture.fixture.id)??0}))),cache:"no-store"});
    console.info("[cron/scores] live player payload",{fixtureIds,providerPlayers:apiIds.length,mappedPlayers:cachedStats.length});
    if(cachedStats.length){
      const response=await fetch(`${url}/rest/v1/football_fixture_player_stats?on_conflict=fixture_id,player_id`,{method:"POST",headers:{...headers(key),Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(cachedStats),cache:"no-store"});
      if(!response.ok)throw new Error((await response.text())||"Shared player-stat cache update failed");
      const syncedFixtureIds=[...new Set(cachedStats.map(row=>row.fixture_id))];
      await fetch(`${url}/rest/v1/football_fixture_cache?fixture_id=in.(${syncedFixtureIds.join(",")})`,{method:"PATCH",headers:{...headers(key),Prefer:"return=minimal"},body:JSON.stringify({stats_synced_at:now.toISOString()}),cache:"no-store"});
    }else{
      console.warn("[cron/scores] provider returned no mapped live player statistics",{fixtureIds});
    }

    const affectedResponse=await fetch(`${url}/rest/v1/league_headline_fixtures?fixture_id=in.(${fixtureIds.join(",")})&select=league_id,fixture_id`,{headers:headers(key),cache:"no-store"});
    const affected=affectedResponse.ok?await affectedResponse.json() as LeagueFixture[]:[];
    const leagueIds=[...new Set(affected.map(row=>row.league_id))];
    let leagueRowsUpdated=0;
    let leagueGameweeksUpdated=0;
    for(const leagueId of leagueIds){
      const [leagueResponse,windowResponse]=await Promise.all([
        fetch(`${url}/rest/v1/leagues?id=eq.${leagueId}&select=calendar_competition,player_pool`,{headers:headers(key),cache:"no-store"}),
        fetch(`${url}/rest/v1/league_transaction_windows?league_id=eq.${leagueId}&select=gameweek,roster_lock_at&order=gameweek.desc&limit=1`,{headers:headers(key),cache:"no-store"}),
      ]);
      const league=(leagueResponse.ok?await leagueResponse.json() as LeagueRow[]:[])[0];
      const window=(windowResponse.ok?await windowResponse.json() as WindowRow[]:[])[0];
      if(!league||!window||new Date(window.roster_lock_at)>now)continue;

      const calendarQuery=new URLSearchParams({league_id:`eq.${leagueId}`,competition:`eq.${league.calendar_competition}`,gameweek:`eq.${window.gameweek}`,select:"fixture_id,status,kickoff",order:"kickoff.asc"});
      const calendarResponse=await fetch(`${url}/rest/v1/league_headline_fixtures?${calendarQuery}`,{headers:headers(key),cache:"no-store"});
      const calendarFixtures=calendarResponse.ok?await calendarResponse.json() as WeekFixture[]:[];
      if(!calendarFixtures.length||new Date(calendarFixtures[0].kickoff)>now)continue;

      const firstKickoff=calendarFixtures[0].kickoff;
      const lastKickoff=calendarFixtures[calendarFixtures.length-1].kickoff;
      const fixtureQuery=new URLSearchParams({league_id:`eq.${leagueId}`,and:`(kickoff.gte.${firstKickoff},kickoff.lte.${lastKickoff})`,select:"fixture_id,status,kickoff"});
      if(league.player_pool!=="All Top Five")fixtureQuery.set("competition",`eq.${league.player_pool}`);
      const weekFixturesResponse=await fetch(`${url}/rest/v1/league_headline_fixtures?${fixtureQuery}`,{headers:headers(key),cache:"no-store"});
      const weekFixtures=weekFixturesResponse.ok?await weekFixturesResponse.json() as WeekFixture[]:[];
      const ids=weekFixtures.map(item=>item.fixture_id);if(!ids.length)continue;
      const statsResponse=await fetch(`${url}/rest/v1/football_fixture_player_stats?fixture_id=in.(${ids.join(",")})&select=*`,{headers:headers(key),cache:"no-store"});
      const stats=statsResponse.ok?await statsResponse.json() as StatRow[]:[];
      const lineupResponse=await fetch(`${url}/rest/v1/lineup_players?league_id=eq.${leagueId}&select=player_id`,{headers:headers(key),cache:"no-store"});
      const lineup=lineupResponse.ok?await lineupResponse.json() as Array<{player_id:number}>:[];
      const playerIds=[...new Set([...lineup.map(item=>item.player_id),...stats.map(item=>item.player_id)])];
      const isFinal=weekFixtures.length>0&&weekFixtures.every(item=>terminal.has(item.status));
      const fixtureStatusById=new Map(weekFixtures.map(item=>[item.fixture_id,item.status]));
      const rows=playerIds.map(playerId=>{
        const playerStats=stats.filter(item=>item.player_id===playerId);
        const ratings=playerStats.map(item=>Number(item.rating)).filter(Boolean);
        const playerFixtureStatuses=[...new Set(playerStats.map(item=>fixtureStatusById.get(item.fixture_id)).filter((status):status is string=>Boolean(status)))];
        return {league_id:leagueId,gameweek:window.gameweek,player_id:playerId,rating:ratings.length?Math.max(...ratings):null,minutes:sum(playerStats,"minutes"),goals:sum(playerStats,"goals"),assists:sum(playerStats,"assists"),shots_on_target:sum(playerStats,"shots_on_target"),big_chances_missed:0,completed_passes:sum(playerStats,"completed_passes"),tackles_won:sum(playerStats,"tackles_won"),penalty_goals:sum(playerStats,"penalty_goals"),penalties_missed:sum(playerStats,"penalties_missed"),penalties_conceded:sum(playerStats,"penalties_conceded"),saves:sum(playerStats,"saves"),penalties_saved:sum(playerStats,"penalties_saved"),goals_conceded:sum(playerStats,"goals_conceded"),yellow_cards:sum(playerStats,"yellow_cards"),second_yellow_cards:0,red_cards:sum(playerStats,"red_cards"),own_goals:0,man_of_the_match:false,status:resolvePlayerScoreStatus(playerFixtureStatuses,isFinal),source:"api-football-shared-cache",source_updated_at:now.toISOString(),updated_at:now.toISOString()};
      });
      const weeklyManOfTheMatchId=isFinal?selectManOfTheMatchId(rows.map(row=>({playerId:row.player_id,rating:Number(row.rating)||0,minutes:row.minutes,goals:row.goals,assists:row.assists,shotsOnTarget:row.shots_on_target}))):null;
      if(weeklyManOfTheMatchId!==null)rows.find(row=>row.player_id===weeklyManOfTheMatchId)!.man_of_the_match=true;
      if(rows.length){
        const response=await fetch(`${url}/rest/v1/league_player_scores?on_conflict=league_id,gameweek,player_id`,{method:"POST",headers:{...headers(key),Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(rows),cache:"no-store"});
        if(!response.ok)throw new Error((await response.text())||`League score update failed for ${leagueId}`);
        leagueRowsUpdated+=rows.length;
        leagueGameweeksUpdated+=1;
        await fetch(`${url}/rest/v1/rpc/refresh_league_matchup_scores`,{method:"POST",headers:headers(key),body:JSON.stringify({p_league_id:leagueId,p_gameweek:window.gameweek}),cache:"no-store"});
      }
    }
    return NextResponse.json({ok:true,ranAt:now.toISOString(),requestsUsed,fixturesEligible:candidates.length,fixturesLive:fixtures.length,sharedPlayerRowsUpdated:cachedStats.length,fantasyLeagueGameweeksUpdated:leagueGameweeksUpdated,leaguePlayerRowsUpdated:leagueRowsUpdated});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Shared live score synchronization failed."},{status:502})}
}
