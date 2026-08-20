import {NextRequest,NextResponse} from "next/server";
import {apiFootball} from "@/lib/api-football-server";

const competitions:Record<string,number>={"Premier League":39,"La Liga":140,"Serie A":135,"Bundesliga":78,"Ligue 1":61};
const finalStatuses=new Set(["FT","AET","PEN"]);
const unstartedStatuses=new Set(["TBD","NS","PST","CANC","ABD","AWD","WO"]);

type Fixture={fixture:{id:number;date:string;status:{short:string}};league:{round:string};teams:{home:{name:string};away:{name:string}};goals:{home:number|null;away:number|null}};
type FixturePage={response:Fixture[]};
type ApiPlayer={player:{id:number};statistics:Array<{games:{minutes:number|null};shots:{on:number|null};goals:{total:number|null;assists:number|null;conceded:number|null;saves:number|null};passes:{total:number|null;accuracy:number|string|null};tackles:{total:number|null};cards:{yellow:number|null;red:number|null};penalty:{scored:number|null;missed:number|null;saved:number|null;commited:number|null}}>};
type PlayersPage={response:Array<{players:ApiPlayer[]}>};
type LeagueRow={calendar_competition:string;player_pool:string};
type PlayerRow={id:number;api_football_id:number|null};
type CachedFixture={kickoff:string;status:string;competition:string};

export const maxDuration=300;

function adminHeaders(key:string){return{apikey:key,Authorization:`Bearer ${key}`,"Content-Type":"application/json"}}
function parseGameweek(round:string){const match=round.match(/(\d+)\s*$/);return match?Number(match[1]):1}
function localDateKey(value:Date){
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/Los_Angeles",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(value);
  const part=(type:Intl.DateTimeFormatPartTypes)=>parts.find(item=>item.type===type)?.value??"";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export async function POST(request:NextRequest){
  const authorization=request.headers.get("authorization")??"";
  if(!authorization.startsWith("Bearer "))return NextResponse.json({error:"Sign in is required."},{status:401});
  const body=await request.json().catch(()=>({})) as {leagueId?:string};
  if(!body.leagueId)return NextResponse.json({error:"Choose a league first."},{status:400});
  const supabaseUrl=process.env.NEXT_PUBLIC_SUPABASE_URL??"https://ocabrgbrkqmsnalbfzvx.supabase.co";
  const publishableKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY??"sb_publishable_DA08c5KwmYXpru6CdrRfHA_4Qe2z3M-";
  const serviceRoleKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!serviceRoleKey)return NextResponse.json({error:"Server database credential is not configured."},{status:503});
  const userHeaders={apikey:publishableKey,Authorization:authorization,"Content-Type":"application/json"};
  const leaguesResponse=await fetch(`${supabaseUrl}/rest/v1/rpc/my_leagues`,{method:"POST",headers:userHeaders,body:"{}",cache:"no-store"});
  const memberships=leaguesResponse.ok?await leaguesResponse.json():[];
  if(!memberships.some((league:{league_id:string;is_commissioner:boolean})=>league.league_id===body.leagueId&&league.is_commissioner))return NextResponse.json({error:"Only this league's commissioner can run an immediate score sync."},{status:403});

  const leagueResponse=await fetch(`${supabaseUrl}/rest/v1/leagues?id=eq.${encodeURIComponent(body.leagueId)}&select=calendar_competition,player_pool`,{headers:adminHeaders(serviceRoleKey),cache:"no-store"});
  const leagueRows=leagueResponse.ok?await leagueResponse.json() as LeagueRow[]:[];
  const competition=leagueRows[0]?.calendar_competition;
  const playerPool=leagueRows[0]?.player_pool;
  const competitionId=competition?competitions[competition]:undefined;
  if(!competitionId)return NextResponse.json({error:"This league does not have a supported Fantasy Calendar."},{status:400});

  const now=new Date();
  const season=now.getUTCMonth()<=5?now.getUTCFullYear()-1:now.getUTCFullYear();
  const requestId=request.headers.get("x-vercel-id");
  const startedAt=Date.now();
  console.log(JSON.stringify({level:"info",msg:"score_sync_start",route:"/api/football/sync/scores",requestId,leagueId:body.leagueId}));
  try{
    const cachedResponse=await fetch(`${supabaseUrl}/rest/v1/league_headline_fixtures?league_id=eq.${encodeURIComponent(body.leagueId)}&competition=eq.${encodeURIComponent(competition)}&select=kickoff,status,competition&limit=1000`,{headers:adminHeaders(serviceRoleKey),cache:"no-store"});
    const cachedFixtures=cachedResponse.ok?await cachedResponse.json() as CachedFixture[]:[];
    const today=localDateKey(now);
    const todayFixtures=cachedFixtures.filter(fixture=>localDateKey(new Date(fixture.kickoff))===today);
    if(cachedFixtures.length>0&&todayFixtures.length===0){
      console.log(JSON.stringify({level:"info",msg:"score_sync_skipped_no_games_today",route:"/api/football/sync/scores",requestId,leagueId:body.leagueId,competition,ms:Date.now()-startedAt}));
      return NextResponse.json({ok:true,skipped:true,status:"no-games-today",competition,requestsUsed:0,message:`${competition} has no games today. No provider requests were used.`});
    }
    if(todayFixtures.length>0&&todayFixtures.every(fixture=>unstartedStatuses.has(fixture.status)||new Date(fixture.kickoff)>now)){
      console.log(JSON.stringify({level:"info",msg:"score_sync_skipped_before_kickoff",route:"/api/football/sync/scores",requestId,leagueId:body.leagueId,competition,ms:Date.now()-startedAt}));
      return NextResponse.json({ok:true,skipped:true,status:"before-kickoff",competition,requestsUsed:0,message:`${competition}'s games have not started yet. No provider requests were used.`});
    }
    if(todayFixtures.length>0&&todayFixtures.every(fixture=>finalStatuses.has(fixture.status))){
      console.log(JSON.stringify({level:"info",msg:"score_sync_skipped_already_final",route:"/api/football/sync/scores",requestId,leagueId:body.leagueId,competition,ms:Date.now()-startedAt}));
      return NextResponse.json({ok:true,skipped:true,status:"already-final",competition,requestsUsed:0,message:`${competition}'s games are already final. No provider requests were used.`});
    }

    const lockResponse=await fetch(`${supabaseUrl}/rest/v1/rpc/acquire_score_sync_lock`,{method:"POST",headers:adminHeaders(serviceRoleKey),body:JSON.stringify({p_league_id:body.leagueId,p_cooldown_seconds:900}),cache:"no-store"});
    if(!lockResponse.ok)throw new Error((await lockResponse.text())||"Score sync lock could not be acquired");
    const lockAcquired=await lockResponse.json() as boolean;
    if(!lockAcquired){
      console.log(JSON.stringify({level:"info",msg:"score_sync_skipped_cooldown",route:"/api/football/sync/scores",requestId,leagueId:body.leagueId,competition,ms:Date.now()-startedAt}));
      return NextResponse.json({ok:true,skipped:true,status:"cooldown",competition,requestsUsed:0,message:"A score sync was attempted recently. Try again in 15 minutes."},{status:202});
    }

    const scheduleCompetitions=playerPool==="All Top Five"?Object.entries(competitions):[[competition,competitionId] as [string,number]];
    const scheduleBodies=await Promise.all(scheduleCompetitions.map(async([name,id])=>({name,body:await apiFootball<FixturePage>(`fixtures?league=${id}&season=${season}`)})));
    const fixtureBody=scheduleBodies.find(item=>item.name===competition)?.body??{response:[]};

    // Cache every eligible competition's schedule. The Fantasy Calendar competition still
    // exclusively controls scoring windows; these extra fixtures only provide opponent and
    // kickoff context for player profiles and the real-world headline section.
    const fixtureRows=scheduleBodies.flatMap(({name,body:scheduled})=>scheduled.response.map(item=>({league_id:body.leagueId,fixture_id:item.fixture.id,gameweek:parseGameweek(item.league.round),competition:name,round_name:item.league.round,kickoff:item.fixture.date,status:item.fixture.status.short,home_team:item.teams.home.name,away_team:item.teams.away.name,home_score:item.goals.home,away_score:item.goals.away,updated_at:new Date().toISOString()})));
    if(fixtureRows.length){
      const fixtureUpsert=await fetch(`${supabaseUrl}/rest/v1/league_headline_fixtures?on_conflict=league_id,fixture_id`,{method:"POST",headers:{...adminHeaders(serviceRoleKey),Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(fixtureRows),cache:"no-store"});
      if(!fixtureUpsert.ok)throw new Error((await fixtureUpsert.text())||"Fixture database update failed");
    }

    const started=fixtureBody.response.filter(item=>!unstartedStatuses.has(item.fixture.status.short)&&new Date(item.fixture.date)<=now);
    const anchor=[...started].sort((a,b)=>Math.abs(now.getTime()-new Date(a.fixture.date).getTime())-Math.abs(now.getTime()-new Date(b.fixture.date).getTime()))[0];
    if(!anchor)return NextResponse.json({ok:true,competition,season,status:"upcoming",fixturesStarted:0,fixturesTotal:fixtureBody.response.length,seasonFixturesCached:fixtureRows.length,playersUpdated:0,requestsUsed:scheduleBodies.length,message:`${competition} has not started yet. Upcoming fixtures are now available on player profiles.`});
    const round=anchor.league.round;
    const roundFixtures=fixtureBody.response.filter(item=>item.league.round===round);
    const activeFixtures=roundFixtures.filter(item=>!unstartedStatuses.has(item.fixture.status.short)&&new Date(item.fixture.date)<=now);
    const allFinal=roundFixtures.length>0&&roundFixtures.every(item=>finalStatuses.has(item.fixture.status.short));
    const roundStatus=allFinal?"final":"live";
    const gameweek=parseGameweek(round);

    const fixturePlayers=await Promise.all(activeFixtures.map(async fixture=>({fixture,body:await apiFootball<PlayersPage>(`fixtures/players?fixture=${fixture.fixture.id}`)})));
    const statsByApiId=new Map<number,Record<string,number>>();
    for(const {body:playerBody} of fixturePlayers){
      for(const team of playerBody.response)for(const entry of team.players){
        const stat=entry.statistics[0];if(!stat)continue;
        const accuracy=Number(String(stat.passes.accuracy??"0").replace("%",""))||0;
        statsByApiId.set(entry.player.id,{minutes:stat.games.minutes??0,goals:stat.goals.total??0,assists:stat.goals.assists??0,shots_on_target:stat.shots.on??0,big_chances_missed:0,completed_passes:Math.round((stat.passes.total??0)*accuracy/100),tackles_won:stat.tackles.total??0,penalty_goals:stat.penalty.scored??0,penalties_missed:stat.penalty.missed??0,penalties_conceded:stat.penalty.commited??0,saves:stat.goals.saves??0,penalties_saved:stat.penalty.saved??0,goals_conceded:stat.goals.conceded??0,yellow_cards:stat.cards.yellow??0,second_yellow_cards:0,red_cards:stat.cards.red??0,own_goals:0});
      }
    }

    const lineupResponse=await fetch(`${supabaseUrl}/rest/v1/lineup_players?league_id=eq.${encodeURIComponent(body.leagueId)}&select=player_id`,{headers:adminHeaders(serviceRoleKey),cache:"no-store"});
    const lineupRows=lineupResponse.ok?await lineupResponse.json() as Array<{player_id:number}>:[];
    const playerIds=[...new Set(lineupRows.map(row=>row.player_id))];
    if(!playerIds.length)return NextResponse.json({error:"No saved lineups exist in this league yet."},{status:409});
    const playersResponse=await fetch(`${supabaseUrl}/rest/v1/players?id=in.(${playerIds.join(",")})&select=id,api_football_id`,{headers:adminHeaders(serviceRoleKey),cache:"no-store"});
    const lineupPlayers=playersResponse.ok?await playersResponse.json() as PlayerRow[]:[];
    const playedApiIds=[...statsByApiId.keys()];
    const playedResponse=playedApiIds.length?await fetch(`${supabaseUrl}/rest/v1/players?api_football_id=in.(${playedApiIds.join(",")})&select=id,api_football_id`,{headers:adminHeaders(serviceRoleKey),cache:"no-store"}):null;
    const playedPlayers=playedResponse?.ok?await playedResponse.json() as PlayerRow[]:[];
    const players=[...new Map([...lineupPlayers,...playedPlayers].map(player=>[player.id,player])).values()];
    const rows=players.map(player=>({league_id:body.leagueId,gameweek,player_id:player.id,minutes:0,goals:0,assists:0,shots_on_target:0,big_chances_missed:0,completed_passes:0,tackles_won:0,penalty_goals:0,penalties_missed:0,penalties_conceded:0,saves:0,penalties_saved:0,goals_conceded:0,yellow_cards:0,second_yellow_cards:0,red_cards:0,own_goals:0,man_of_the_match:false,status:roundStatus,source:"api-football-live",source_updated_at:new Date().toISOString(),updated_at:new Date().toISOString(),...(player.api_football_id?statsByApiId.get(player.api_football_id)??{}:{})}));
    const upsert=await fetch(`${supabaseUrl}/rest/v1/league_player_scores?on_conflict=league_id,gameweek,player_id`,{method:"POST",headers:{...adminHeaders(serviceRoleKey),Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(rows),cache:"no-store"});
    if(!upsert.ok)throw new Error((await upsert.text())||"Score database update failed");
    console.log(JSON.stringify({level:"info",msg:"score_sync_done",route:"/api/football/sync/scores",requestId,leagueId:body.leagueId,competition,requestsUsed:scheduleBodies.length+activeFixtures.length,ms:Date.now()-startedAt}));
    return NextResponse.json({ok:true,competition,season,round,gameweek,status:roundStatus,fixturesStarted:activeFixtures.length,fixturesTotal:roundFixtures.length,seasonFixturesCached:fixtureRows.length,playersWithStats:statsByApiId.size,playersUpdated:rows.length,lineupPlayersUpdated:lineupPlayers.length,requestsUsed:scheduleBodies.length+activeFixtures.length,limitations:["Completed passes are estimated from total passes and API accuracy.","Big chances missed and Man of the Match remain unavailable from this endpoint and currently score zero."]});
  }catch(error){
    console.error(JSON.stringify({level:"error",msg:"score_sync_failed",route:"/api/football/sync/scores",requestId,leagueId:body.leagueId,competition,error:error instanceof Error?error.message:String(error),ms:Date.now()-startedAt}));
    return NextResponse.json({error:error instanceof Error?error.message:"Live score synchronization failed."},{status:502});
  }
}
