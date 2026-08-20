import {NextRequest,NextResponse} from "next/server";
import {apiFootball} from "@/lib/api-football-server";

const competitions:Record<string,number>={"Premier League":39,"La Liga":140,"Serie A":135,"Bundesliga":78,"Ligue 1":61};
type Fixture={fixture:{id:number;date:string;status:{short:string}};league:{round:string};teams:{home:{name:string};away:{name:string}};goals:{home:number|null;away:number|null}};
type FixturePage={response:Fixture[]};
type League={id:string;calendar_competition:string;player_pool:string};

export const dynamic="force-dynamic";
export const maxDuration=300;

function headers(key:string){return{apikey:key,Authorization:`Bearer ${key}`,"Content-Type":"application/json"}}
function gameweek(round:string){const match=round.match(/(\d+)\s*$/);return match?Number(match[1]):1}

export async function GET(request:NextRequest){
  const secret=process.env.CRON_SECRET;
  if(!secret||request.headers.get("authorization")!==`Bearer ${secret}`)return NextResponse.json({error:"Unauthorized"},{status:401});
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL??"https://ocabrgbrkqmsnalbfzvx.supabase.co";
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!key)return NextResponse.json({error:"Server database credential is not configured."},{status:503});
  const now=new Date();
  const season=now.getUTCMonth()<=5?now.getUTCFullYear()-1:now.getUTCFullYear();
  try{
    // This is the only automated full-season download: exactly one request for
    // each real competition, regardless of the number of fantasy leagues.
    const schedules=await Promise.all(Object.entries(competitions).map(async([competition,competitionId])=>({competition,competitionId,body:await apiFootball<FixturePage>(`fixtures?league=${competitionId}&season=${season}`)})));
    const canonical=schedules.flatMap(({competition,competitionId,body})=>body.response.map(item=>({fixture_id:item.fixture.id,competition,competition_id:competitionId,season,gameweek:gameweek(item.league.round),round_name:item.league.round,kickoff:item.fixture.date,status:item.fixture.status.short,home_team:item.teams.home.name,away_team:item.teams.away.name,home_score:item.goals.home,away_score:item.goals.away,updated_at:now.toISOString()})));
    const cache=await fetch(`${url}/rest/v1/football_fixture_cache?on_conflict=fixture_id`,{method:"POST",headers:{...headers(key),Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(canonical),cache:"no-store"});
    if(!cache.ok)throw new Error((await cache.text())||"Canonical schedule update failed");

    const leagueResponse=await fetch(`${url}/rest/v1/leagues?select=id,calendar_competition,player_pool&game_format=in.(draft,auction,pack)&calendar_competition=not.is.null`,{headers:headers(key),cache:"no-store"});
    if(!leagueResponse.ok)throw new Error((await leagueResponse.text())||"League lookup failed");
    const leagues=await leagueResponse.json() as League[];
    let copied=0;
    for(const league of leagues){
      const allowed=league.player_pool==="All Top Five"?new Set(Object.keys(competitions)):new Set([league.calendar_competition]);
      const rows=canonical.filter(item=>allowed.has(item.competition)).map(item=>({league_id:league.id,fixture_id:item.fixture_id,gameweek:item.gameweek,competition:item.competition,round_name:item.round_name,kickoff:item.kickoff,status:item.status,home_team:item.home_team,away_team:item.away_team,home_score:item.home_score,away_score:item.away_score,updated_at:item.updated_at}));
      if(!rows.length)continue;
      const response=await fetch(`${url}/rest/v1/league_headline_fixtures?on_conflict=league_id,fixture_id`,{method:"POST",headers:{...headers(key),Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(rows),cache:"no-store"});
      if(!response.ok)throw new Error((await response.text())||`Schedule copy failed for ${league.id}`);
      copied+=rows.length;
      await fetch(`${url}/rest/v1/rpc/refresh_league_calendar`,{method:"POST",headers:headers(key),body:JSON.stringify({p_league_id:league.id}),cache:"no-store"});
    }
    return NextResponse.json({ok:true,season,requestsUsed:schedules.length,fixturesCached:canonical.length,leagueFixtureRowsCopied:copied,leaguesUpdated:leagues.length});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Schedule synchronization failed."},{status:502})}
}
