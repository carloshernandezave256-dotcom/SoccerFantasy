import {NextRequest,NextResponse} from "next/server";
import {apiFootball} from "@/lib/api-football-server";
import {isDeveloperRequest} from "@/lib/developer-auth";
import {selectManOfTheMatchId} from "@/lib/match-awards";

const competitions:Record<string,number>={"Premier League":39,"La Liga":140,"Serie A":135,"Bundesliga":78,"Ligue 1":61};
const finalStatuses=new Set(["FT","AET","PEN"]);
const unstartedStatuses=new Set(["TBD","NS","PST","CANC","ABD","AWD","WO"]);

type Fixture={fixture:{id:number;date:string;status:{short:string}};league:{round:string};teams:{home:{name:string};away:{name:string}};goals:{home:number|null;away:number|null}};
type FixturePage={response:Fixture[]};
type ApiPlayer={player:{id:number};statistics:Array<{games:{minutes:number|null;rating:string|null};shots:{on:number|null};goals:{total:number|null;assists:number|null;conceded:number|null;saves:number|null};passes:{total:number|null;accuracy:number|string|null};tackles:{total:number|null};cards:{yellow:number|null;red:number|null};penalty:{scored:number|null;missed:number|null;saved:number|null;commited:number|null}}>};
type PlayersPage={response:Array<{players:ApiPlayer[]}>};
type LeagueRow={calendar_competition:string;player_pool:string};
type PlayerRow={id:number;api_football_id:number|null};

export const maxDuration=300;

function adminHeaders(key:string){return{apikey:key,Authorization:`Bearer ${key}`,"Content-Type":"application/json"}}
function parseGameweek(round:string){const match=round.match(/(\d+)\s*$/);return match?Number(match[1]):1}

export async function POST(request:NextRequest){
  const authorization=request.headers.get("authorization")??"";
  if(!authorization.startsWith("Bearer "))return NextResponse.json({error:"Sign in is required."},{status:401});
  const cronAuthorized=Boolean(process.env.CRON_SECRET)&&authorization===`Bearer ${process.env.CRON_SECRET}`;
  if(!cronAuthorized&&!await isDeveloperRequest(request))return NextResponse.json({error:"Developer access required."},{status:403});
  const body=await request.json().catch(()=>({})) as {leagueId?:string};
  if(!body.leagueId)return NextResponse.json({error:"Choose a league first."},{status:400});
  const supabaseUrl=process.env.NEXT_PUBLIC_SUPABASE_URL??"https://ocabrgbrkqmsnalbfzvx.supabase.co";
  const publishableKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY??"sb_publishable_DA08c5KwmYXpru6CdrRfHA_4Qe2z3M-";
  const serviceRoleKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!serviceRoleKey)return NextResponse.json({error:"Server database credential is not configured."},{status:503});
  if(!cronAuthorized){
    const userHeaders={apikey:publishableKey,Authorization:authorization,"Content-Type":"application/json"};
    const leaguesResponse=await fetch(`${supabaseUrl}/rest/v1/rpc/my_leagues`,{method:"POST",headers:userHeaders,body:"{}",cache:"no-store"});
    const memberships=leaguesResponse.ok?await leaguesResponse.json():[];
    if(!memberships.some((league:{league_id:string})=>league.league_id===body.leagueId))return NextResponse.json({error:"Choose one of your leagues."},{status:403});
  }

  const leagueResponse=await fetch(`${supabaseUrl}/rest/v1/leagues?id=eq.${encodeURIComponent(body.leagueId)}&select=calendar_competition,player_pool`,{headers:adminHeaders(serviceRoleKey),cache:"no-store"});
  const leagueRows=leagueResponse.ok?await leagueResponse.json() as LeagueRow[]:[];
  const competition=leagueRows[0]?.calendar_competition;
  const playerPool=leagueRows[0]?.player_pool;
  const competitionId=competition?competitions[competition]:undefined;
  if(!competitionId)return NextResponse.json({error:"This league does not have a supported Fantasy Calendar."},{status:400});

  const now=new Date();
  const season=now.getUTCMonth()<=5?now.getUTCFullYear()-1:now.getUTCFullYear();
  try{
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
    const statsByApiId=new Map<number,Record<string,number|boolean|null>>();
    for(const {body:playerBody} of fixturePlayers){
      const fixtureEntries=playerBody.response.flatMap(team=>team.players).flatMap(entry=>entry.statistics.slice(0,1).map(stat=>({entry,stat})));
      const manOfTheMatchId=selectManOfTheMatchId(fixtureEntries.map(({entry,stat})=>({playerId:entry.player.id,rating:Number(stat.games.rating) || 0,minutes:stat.games.minutes??0,goals:stat.goals.total??0,assists:stat.goals.assists??0,shotsOnTarget:stat.shots.on??0})));
      for(const {entry,stat} of fixtureEntries){
        const accuracy=Number(String(stat.passes.accuracy??"0").replace("%",""))||0;
        const rating=Number(stat.games.rating)||0;
        statsByApiId.set(entry.player.id,{rating:rating>0?rating:null,minutes:stat.games.minutes??0,goals:stat.goals.total??0,assists:stat.goals.assists??0,shots_on_target:stat.shots.on??0,big_chances_missed:0,completed_passes:Math.round((stat.passes.total??0)*accuracy/100),tackles_won:stat.tackles.total??0,penalty_goals:stat.penalty.scored??0,penalties_missed:stat.penalty.missed??0,penalties_conceded:stat.penalty.commited??0,saves:stat.goals.saves??0,penalties_saved:stat.penalty.saved??0,goals_conceded:stat.goals.conceded??0,yellow_cards:stat.cards.yellow??0,second_yellow_cards:0,red_cards:stat.cards.red??0,own_goals:0,man_of_the_match:entry.player.id===manOfTheMatchId});
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
    const rows=players.map(player=>({league_id:body.leagueId,gameweek,player_id:player.id,rating:null,minutes:0,goals:0,assists:0,shots_on_target:0,big_chances_missed:0,completed_passes:0,tackles_won:0,penalty_goals:0,penalties_missed:0,penalties_conceded:0,saves:0,penalties_saved:0,goals_conceded:0,yellow_cards:0,second_yellow_cards:0,red_cards:0,own_goals:0,man_of_the_match:false,status:roundStatus,source:"api-football-live",source_updated_at:new Date().toISOString(),updated_at:new Date().toISOString(),...(player.api_football_id?statsByApiId.get(player.api_football_id)??{}:{})}));
    const upsert=await fetch(`${supabaseUrl}/rest/v1/league_player_scores?on_conflict=league_id,gameweek,player_id`,{method:"POST",headers:{...adminHeaders(serviceRoleKey),Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(rows),cache:"no-store"});
    if(!upsert.ok)throw new Error((await upsert.text())||"Score database update failed");
    const refresh=await fetch(`${supabaseUrl}/rest/v1/rpc/refresh_league_matchup_scores`,{method:"POST",headers:adminHeaders(serviceRoleKey),body:JSON.stringify({p_league_id:body.leagueId,p_gameweek:gameweek}),cache:"no-store"});
    if(!refresh.ok)throw new Error((await refresh.text())||"Matchup total refresh failed");
    const matchupsUpdated=Number(await refresh.json())||0;
    return NextResponse.json({ok:true,competition,season,round,gameweek,status:roundStatus,fixturesStarted:activeFixtures.length,fixturesTotal:roundFixtures.length,seasonFixturesCached:fixtureRows.length,playersWithStats:statsByApiId.size,playersUpdated:rows.length,lineupPlayersUpdated:lineupPlayers.length,matchupsUpdated,requestsUsed:scheduleBodies.length+activeFixtures.length,notes:["Completed passes are estimated from total passes and API accuracy.","Man of the Match is awarded automatically to the highest API-rated player in each fixture.","Big chances missed is not part of fantasy scoring."]});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Live score synchronization failed."},{status:502})}
}
