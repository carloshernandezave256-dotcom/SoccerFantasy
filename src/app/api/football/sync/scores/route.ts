import {NextRequest,NextResponse} from "next/server";
import {apiFootball} from "@/lib/api-football-server";
import {isDeveloperRequest} from "@/lib/developer-auth";
import {LiveScoreStore} from "@/lib/live-score-store";
import {synchronizeFixtureScores} from "@/lib/live-score-sync";

const competitions:Record<string,number>={"Premier League":39,"La Liga":140,"Serie A":135,"Bundesliga":78,"Ligue 1":61};
type Fixture={fixture:{id:number;date:string;status:{short:string}};league:{round:string};teams:{home:{id:number;name:string};away:{id:number;name:string}};goals:{home:number|null;away:number|null}};
type FixturePage={response:Fixture[]};
type LeagueRow={calendar_competition:string;player_pool:string};
type TransactionWindowRow={gameweek:number};

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
  const windowResponse=await fetch(`${supabaseUrl}/rest/v1/league_transaction_windows?league_id=eq.${encodeURIComponent(body.leagueId)}&select=gameweek&order=gameweek.desc&limit=1`,{headers:adminHeaders(serviceRoleKey),cache:"no-store"});
  const windowRows=windowResponse.ok?await windowResponse.json() as TransactionWindowRow[]:[];
  const gameweek=windowRows[0]?.gameweek;
  if(!gameweek)return NextResponse.json({error:"This league does not have an active fantasy gameweek."},{status:409});

  const now=new Date();
  const season=now.getUTCMonth()<=5?now.getUTCFullYear()-1:now.getUTCFullYear();
  const store=new LiveScoreStore(supabaseUrl,serviceRoleKey);
  try{
    if(!await store.claimSync(now))return NextResponse.json({ok:true,message:"A score update is already running. Try again shortly.",requestsUsed:0});
    const scheduleCompetitions=playerPool==="All Top Five"?Object.entries(competitions):[[competition,competitionId] as [string,number]];
    const scheduleBodies=await Promise.all(scheduleCompetitions.map(async([name,id])=>({name,body:await apiFootball<FixturePage>(`fixtures?league=${id}&season=${season}`)})));

    // Cache every eligible competition's schedule. The Fantasy Calendar competition still
    // exclusively controls scoring windows; these extra fixtures only provide opponent and
    // kickoff context for player profiles and the real-world headline section.
    const fixtureRows=scheduleBodies.flatMap(({name,body:scheduled})=>scheduled.response.map(item=>({league_id:body.leagueId,fixture_id:item.fixture.id,gameweek:parseGameweek(item.league.round),competition:name,round_name:item.league.round,kickoff:item.fixture.date,status:item.fixture.status.short,home_team:item.teams.home.name,away_team:item.teams.away.name,home_score:item.goals.home,away_score:item.goals.away,updated_at:new Date().toISOString()})));
    if(fixtureRows.length){
      const fixtureUpsert=await fetch(`${supabaseUrl}/rest/v1/league_headline_fixtures?on_conflict=league_id,fixture_id`,{method:"POST",headers:{...adminHeaders(serviceRoleKey),Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(fixtureRows),cache:"no-store"});
      if(!fixtureUpsert.ok)throw new Error((await fixtureUpsert.text())||"Fixture database update failed");
      const calendarRefresh=await fetch(`${supabaseUrl}/rest/v1/rpc/refresh_league_calendar`,{method:"POST",headers:adminHeaders(serviceRoleKey),body:JSON.stringify({p_league_id:body.leagueId}),cache:"no-store"});
      if(!calendarRefresh.ok)throw new Error((await calendarRefresh.text())||"Automatic gameweek activation failed");
    }

    const context=await store.leagueContext(body.leagueId);
    const activeWeek=context.window?.gameweek;
    if(!activeWeek)return NextResponse.json({error:"No active fantasy gameweek."},{status:409});
    if(await store.gameweekFinalized(body.leagueId,activeWeek))return NextResponse.json({ok:true,message:"This fantasy week is finalized; scores were preserved.",requestsUsed:scheduleBodies.length,seasonFixturesCached:fixtureRows.length});
    const scoringFixtures=await store.scoringWeekFixtures(body.leagueId,activeWeek);
    const candidates=scoringFixtures.filter(f=>f.status!=="EXCLUDED"&&new Date(f.kickoff)<=now);
    if(!candidates.length)return NextResponse.json({ok:true,message:"No eligible matches have started in this fantasy week.",requestsUsed:scheduleBodies.length,seasonFixturesCached:fixtureRows.length});
    const result=await synchronizeFixtureScores(store,candidates,now);
    return NextResponse.json({...result,competition,gameweek:activeWeek,round:`Regular Season - ${activeWeek}`,
      fixturesStarted:candidates.length,fixturesTotal:scoringFixtures.length,
      playersUpdated:'leaguePlayerRowsUpdated' in result?result.leaguePlayerRowsUpdated:0,
      seasonFixturesCached:fixtureRows.length,requestsUsed:result.requestsUsed+scheduleBodies.length});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Live score synchronization failed."},{status:502})}
}
