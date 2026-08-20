import {NextRequest,NextResponse} from "next/server";
import {apiFootball} from "@/lib/api-football-server";
import {selectManOfTheMatchId} from "@/lib/match-awards";

const terminal=new Set(["FT","AET","PEN","PST","CANC","ABD","AWD","WO"]);
type CachedFixture={fixture_id:number;status:string;kickoff:string};
type LiveFixture={fixture:{id:number;date:string;status:{short:string}};goals:{home:number|null;away:number|null}};
type LivePage={response:LiveFixture[]};
type ApiPlayer={player:{id:number};statistics:Array<{games:{minutes:number|null;rating:string|null};shots:{on:number|null};goals:{total:number|null;assists:number|null;conceded:number|null;saves:number|null};passes:{total:number|null;accuracy:number|string|null};tackles:{total:number|null};cards:{yellow:number|null;red:number|null};penalty:{scored:number|null;missed:number|null;saved:number|null;commited:number|null}}>};
type PlayersPage={response:Array<{players:ApiPlayer[]}>};
type Player={id:number;api_football_id:number|null};
type LeagueFixture={league_id:string;fixture_id:number;gameweek:number};
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
  const claim=await fetch(`${url}/rest/v1/football_sync_state?singleton_id=eq.1&live_claimed_until=lt.${now.toISOString()}`,{method:"PATCH",headers:{...headers(key),Prefer:"return=representation"},body:JSON.stringify({live_claimed_until:new Date(now.getTime()+150000).toISOString(),updated_at:now.toISOString()}),cache:"no-store"});
  if(!claim.ok)return NextResponse.json({error:(await claim.text())||"Could not claim the shared synchronization lock."},{status:502});
  const claimed=await claim.json() as Array<{singleton_id:number}>;
  if(!claimed.length)return NextResponse.json({ok:true,ranAt:now.toISOString(),requestsUsed:0,reason:"A shared live-score synchronization is already running."});
  const windowStart=new Date(now.getTime()-4*60*60*1000).toISOString();
  const query=new URLSearchParams({select:"fixture_id,status,kickoff",and:`(kickoff.gte.${windowStart},kickoff.lte.${now.toISOString()},status.not.in.(FT,AET,PEN,PST,CANC,ABD,AWD,WO))`});
  const candidatesResponse=await fetch(`${url}/rest/v1/football_fixture_cache?${query}`,{headers:headers(key),cache:"no-store"});
  if(!candidatesResponse.ok)return NextResponse.json({error:(await candidatesResponse.text())||"Could not read the fixture cache."},{status:502});
  const candidates=await candidatesResponse.json() as CachedFixture[];
  if(!candidates.length)return NextResponse.json({ok:true,ranAt:now.toISOString(),requestsUsed:0,reason:"No cached fixture is inside a possible live-match window."});

  try{
    const live=await apiFootball<LivePage>("fixtures?live=all");
    let requestsUsed=1;
    const candidateIds=new Set(candidates.map(item=>item.fixture_id));
    const fixtures=live.response.filter(item=>candidateIds.has(item.fixture.id));
    if(!fixtures.length)return NextResponse.json({ok:true,ranAt:now.toISOString(),requestsUsed,fixturesEligible:candidates.length,fixturesLive:0,reason:"Cached fixtures were near kickoff, but none is live at the provider."});
    const fixtureIds=fixtures.map(item=>item.fixture.id);

    const fixtureUpdates=await Promise.all(fixtures.map(async item=>{
      const values={status:item.fixture.status.short,kickoff:item.fixture.date,home_score:item.goals.home,away_score:item.goals.away,updated_at:now.toISOString()};
      const [canonical,leagueCopies]=await Promise.all([
        fetch(`${url}/rest/v1/football_fixture_cache?fixture_id=eq.${item.fixture.id}`,{method:"PATCH",headers:{...headers(key),Prefer:"return=minimal"},body:JSON.stringify(values),cache:"no-store"}),
        fetch(`${url}/rest/v1/league_headline_fixtures?fixture_id=eq.${item.fixture.id}`,{method:"PATCH",headers:{...headers(key),Prefer:"return=minimal"},body:JSON.stringify(values),cache:"no-store"}),
      ]);
      return canonical.ok&&leagueCopies.ok;
    }));
    if(fixtureUpdates.some(ok=>!ok))throw new Error("Fixture status update failed");

    const pages=await Promise.all(fixtures.map(async fixture=>({fixture,body:await apiFootball<PlayersPage>(`fixtures/players?fixture=${fixture.fixture.id}`)})));
    requestsUsed+=pages.length;
    const apiIds=[...new Set(pages.flatMap(({body})=>body.response.flatMap(team=>team.players.map(entry=>entry.player.id))))];
    const playersResponse=apiIds.length?await fetch(`${url}/rest/v1/players?api_football_id=in.(${apiIds.join(",")})&select=id,api_football_id`,{headers:headers(key),cache:"no-store"}):null;
    const players=playersResponse?.ok?await playersResponse.json() as Player[]:[];
    const internalByApi=new Map(players.map(player=>[player.api_football_id,player.id]));
    const cachedStats:StatRow[]=[];
    for(const {fixture,body} of pages){
      const entries=body.response.flatMap(team=>team.players).flatMap(entry=>entry.statistics.slice(0,1).map(stat=>({entry,stat})));
      const motm=selectManOfTheMatchId(entries.map(({entry,stat})=>({playerId:entry.player.id,rating:Number(stat.games.rating)||0,minutes:stat.games.minutes??0,goals:stat.goals.total??0,assists:stat.goals.assists??0,shotsOnTarget:stat.shots.on??0})));
      for(const {entry,stat} of entries){
        const playerId=internalByApi.get(entry.player.id);if(!playerId)continue;
        const accuracy=Number(String(stat.passes.accuracy??"0").replace("%",""))||0;
        cachedStats.push({fixture_id:fixture.fixture.id,player_id:playerId,rating:Number(stat.games.rating)||null,minutes:stat.games.minutes??0,goals:stat.goals.total??0,assists:stat.goals.assists??0,shots_on_target:stat.shots.on??0,completed_passes:Math.round((stat.passes.total??0)*accuracy/100),tackles_won:stat.tackles.total??0,penalty_goals:stat.penalty.scored??0,penalties_missed:stat.penalty.missed??0,penalties_conceded:stat.penalty.commited??0,saves:stat.goals.saves??0,penalties_saved:stat.penalty.saved??0,goals_conceded:stat.goals.conceded??0,yellow_cards:stat.cards.yellow??0,red_cards:stat.cards.red??0,man_of_the_match:entry.player.id===motm,source_updated_at:now.toISOString()});
      }
    }
    if(cachedStats.length){
      const response=await fetch(`${url}/rest/v1/football_fixture_player_stats?on_conflict=fixture_id,player_id`,{method:"POST",headers:{...headers(key),Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(cachedStats),cache:"no-store"});
      if(!response.ok)throw new Error((await response.text())||"Shared player-stat cache update failed");
    }
    await fetch(`${url}/rest/v1/football_fixture_cache?fixture_id=in.(${fixtureIds.join(",")})`,{method:"PATCH",headers:{...headers(key),Prefer:"return=minimal"},body:JSON.stringify({stats_synced_at:now.toISOString()}),cache:"no-store"});

    const affectedResponse=await fetch(`${url}/rest/v1/league_headline_fixtures?fixture_id=in.(${fixtureIds.join(",")})&select=league_id,fixture_id,gameweek`,{headers:headers(key),cache:"no-store"});
    const affected=affectedResponse.ok?await affectedResponse.json() as LeagueFixture[]:[];
    const groups=[...new Map(affected.map(row=>[`${row.league_id}:${row.gameweek}`,row])).values()];
    let leagueRowsUpdated=0;
    for(const group of groups){
      const weekFixturesResponse=await fetch(`${url}/rest/v1/league_headline_fixtures?league_id=eq.${group.league_id}&gameweek=eq.${group.gameweek}&select=fixture_id,status`,{headers:headers(key),cache:"no-store"});
      const weekFixtures=weekFixturesResponse.ok?await weekFixturesResponse.json() as Array<{fixture_id:number;status:string}>:[];
      const ids=weekFixtures.map(item=>item.fixture_id);if(!ids.length)continue;
      const statsResponse=await fetch(`${url}/rest/v1/football_fixture_player_stats?fixture_id=in.(${ids.join(",")})&select=*`,{headers:headers(key),cache:"no-store"});
      const stats=statsResponse.ok?await statsResponse.json() as StatRow[]:[];
      const lineupResponse=await fetch(`${url}/rest/v1/lineup_players?league_id=eq.${group.league_id}&select=player_id`,{headers:headers(key),cache:"no-store"});
      const lineup=lineupResponse.ok?await lineupResponse.json() as Array<{player_id:number}>:[];
      const playerIds=[...new Set([...lineup.map(item=>item.player_id),...stats.map(item=>item.player_id)])];
      const isFinal=weekFixtures.length>0&&weekFixtures.every(item=>terminal.has(item.status));
      const rows=playerIds.map(playerId=>{
        const playerStats=stats.filter(item=>item.player_id===playerId);
        const ratings=playerStats.map(item=>Number(item.rating)).filter(Boolean);
        return {league_id:group.league_id,gameweek:group.gameweek,player_id:playerId,rating:ratings.length?Math.max(...ratings):null,minutes:sum(playerStats,"minutes"),goals:sum(playerStats,"goals"),assists:sum(playerStats,"assists"),shots_on_target:sum(playerStats,"shots_on_target"),big_chances_missed:0,completed_passes:sum(playerStats,"completed_passes"),tackles_won:sum(playerStats,"tackles_won"),penalty_goals:sum(playerStats,"penalty_goals"),penalties_missed:sum(playerStats,"penalties_missed"),penalties_conceded:sum(playerStats,"penalties_conceded"),saves:sum(playerStats,"saves"),penalties_saved:sum(playerStats,"penalties_saved"),goals_conceded:sum(playerStats,"goals_conceded"),yellow_cards:sum(playerStats,"yellow_cards"),second_yellow_cards:0,red_cards:sum(playerStats,"red_cards"),own_goals:0,man_of_the_match:playerStats.some(item=>item.man_of_the_match===true),status:isFinal?"final":"live",source:"api-football-shared-cache",source_updated_at:now.toISOString(),updated_at:now.toISOString()};
      });
      if(rows.length){
        const response=await fetch(`${url}/rest/v1/league_player_scores?on_conflict=league_id,gameweek,player_id`,{method:"POST",headers:{...headers(key),Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(rows),cache:"no-store"});
        if(!response.ok)throw new Error((await response.text())||`League score update failed for ${group.league_id}`);
        leagueRowsUpdated+=rows.length;
        await fetch(`${url}/rest/v1/rpc/refresh_league_matchup_scores`,{method:"POST",headers:headers(key),body:JSON.stringify({p_league_id:group.league_id,p_gameweek:group.gameweek}),cache:"no-store"});
      }
    }
    return NextResponse.json({ok:true,ranAt:now.toISOString(),requestsUsed,fixturesEligible:candidates.length,fixturesLive:fixtures.length,sharedPlayerRowsUpdated:cachedStats.length,fantasyLeagueGameweeksUpdated:groups.length,leaguePlayerRowsUpdated:leagueRowsUpdated});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Shared live score synchronization failed."},{status:502})}
}
