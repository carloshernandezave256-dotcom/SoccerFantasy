import {NextRequest,NextResponse} from "next/server";
import {
  buildLeaguePlayerScoreRows,
  normalizeProviderPlayerPages,
  providerPlayerIds,
  TERMINAL_FIXTURE_STATUSES,
  type CachedFixture,
  type WeekFixture,
} from "@/lib/live-score-domain";
import {fantasyWeekWindow,fixturesForFantasyWeek} from "@/lib/fantasy-week-window";
import {fetchProviderLineups,fetchProviderOwnGoals,fetchProviderSnapshot} from "@/lib/live-score-provider";
import {LiveScoreStore,type LeagueConfig} from "@/lib/live-score-store";
import {fetchAllRestRows} from "@/lib/supabase-rest";

export const dynamic="force-dynamic";
export const maxDuration=300;

const TRUSTED_DNP_SOURCES=new Set([
  "fotmob-verified-not-in-matchday-squad",
  "api-football-verified-not-in-matchday-squad",
]);

type PendingMatchup={league_id:string;gameweek:number;status:string};
type SnapshotPlayer={player_id:number};
type ScoreEvidence={player_id:number;status:string;stats_received:boolean|null;source:string|null;minutes:number;fantasy_points:number};
type RecoveryPlayer={id:number;api_football_id:number|null;full_name:string;club:string;competition:string};
type MatchupState={status:string};

type RecoveryWeek={
  leagueId:string;
  gameweek:number;
  attemptedFixtures:number[];
  providerRows:number;
  verifiedDnps:string[];
  stillPending:string[];
  final:boolean;
};

function headers(serviceRoleKey:string){
  return {apikey:serviceRoleKey,Authorization:`Bearer ${serviceRoleKey}`,"Content-Type":"application/json"};
}

async function read<T>(baseUrl:string,serviceRoleKey:string,path:string){
  return fetchAllRestRows<T>(`${baseUrl}/rest/v1/${path}`,headers(serviceRoleKey));
}

async function patch(baseUrl:string,serviceRoleKey:string,path:string,body:unknown){
  const response=await fetch(`${baseUrl}/rest/v1/${path}`,{
    method:"PATCH",headers:{...headers(serviceRoleKey),Prefer:"return=minimal"},body:JSON.stringify(body),cache:"no-store",
  });
  if(!response.ok)throw new Error((await response.text())||"Gameweek recovery update failed");
}

function norm(value:string|undefined){
  return (value??"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g," ").trim();
}

function evidenceResolved(score:ScoreEvidence|undefined){
  return Boolean(score&&(score.stats_received||(
    score.status==="final"&&TRUSTED_DNP_SOURCES.has(score.source??"")&&Number(score.minutes)===0&&Number(score.fantasy_points)===0
  )));
}

async function scoringFixturesForWeek(
  store:LiveScoreStore,
  leagueId:string,
  league:LeagueConfig,
  gameweek:number,
):Promise<WeekFixture[]> {
  const calendarFixtures=await store.calendarFixtures(leagueId,league.calendar_competition,gameweek);
  if(!calendarFixtures.length)return [];
  const scoringWindow=fantasyWeekWindow(calendarFixtures);
  if(!scoringWindow)return [];
  const windowFixtures=await store.weekFixtures(
    leagueId,league.player_pool,scoringWindow.startsAt,scoringWindow.endsAt,
  );
  return fixturesForFantasyWeek(
    windowFixtures.map(fixture=>({...fixture,officialRound:fixture.gameweek})),
    scoringWindow,
    {[league.calendar_competition]:gameweek},
  );
}

function fixtureForPlayer(player:RecoveryPlayer,fixtures:WeekFixture[]){
  const club=norm(player.club);
  return fixtures.find(fixture=>
    fixture.competition===player.competition&&
    (norm(fixture.home_team)===club||norm(fixture.away_team)===club)
  );
}

async function unresolvedPlayers(
  baseUrl:string,
  serviceRoleKey:string,
  leagueId:string,
  gameweek:number,
){
  const snapshot=await read<SnapshotPlayer>(
    baseUrl,serviceRoleKey,
    `lineup_gameweek_players?league_id=eq.${leagueId}&gameweek=eq.${gameweek}&select=player_id`,
  );
  if(!snapshot.length)return {players:[] as RecoveryPlayer[],scores:new Map<number,ScoreEvidence>()};
  const playerIds=[...new Set(snapshot.map(row=>row.player_id))];
  const scores=await read<ScoreEvidence>(
    baseUrl,serviceRoleKey,
    `league_player_scores?league_id=eq.${leagueId}&gameweek=eq.${gameweek}&player_id=in.(${playerIds.join(",")})&select=player_id,status,stats_received,source,minutes,fantasy_points`,
  );
  const scoreByPlayer=new Map(scores.map(score=>[score.player_id,score]));
  const unresolved=playerIds.filter(playerId=>!evidenceResolved(scoreByPlayer.get(playerId)));
  if(!unresolved.length)return {players:[] as RecoveryPlayer[],scores:scoreByPlayer};
  const players=await read<RecoveryPlayer>(
    baseUrl,serviceRoleKey,
    `players?id=in.(${unresolved.join(",")})&select=id,api_football_id,full_name,club,competition`,
  );
  return {players,scores:scoreByPlayer};
}

async function rebuildLeagueWeek(
  store:LiveScoreStore,
  leagueId:string,
  league:LeagueConfig,
  gameweek:number,
  fixtures:WeekFixture[],
  updatedAt:string,
){
  const fixtureIds=fixtures.map(fixture=>fixture.fixture_id);
  const [fixtureStats,lineupPlayerIds,poolPlayerIds]=await Promise.all([
    store.fixtureStats(fixtureIds),store.lineupPlayerIds(leagueId),store.poolPlayerIds(league.player_pool),
  ]);
  const playerIds=[...new Set([...poolPlayerIds,...lineupPlayerIds,...fixtureStats.map(row=>row.player_id)])];
  const rows=buildLeaguePlayerScoreRows({leagueId,gameweek,playerIds,fixtureStats,weekFixtures:fixtures,updatedAt});
  await store.upsertLeagueScores(rows);
  await store.refreshMatchupScores(leagueId,gameweek);
  return rows.length;
}

async function recoverWeek(
  store:LiveScoreStore,
  baseUrl:string,
  serviceRoleKey:string,
  leagueId:string,
  gameweek:number,
  now:Date,
):Promise<RecoveryWeek>{
  const ranAt=now.toISOString();
  const context=await store.leagueContext(leagueId);
  if(!context.league)return {leagueId,gameweek,attemptedFixtures:[],providerRows:0,verifiedDnps:[],stillPending:[],final:false};
  const league=context.league;
  const fixtures=await scoringFixturesForWeek(store,leagueId,league,gameweek);
  if(!fixtures.length)return {leagueId,gameweek,attemptedFixtures:[],providerRows:0,verifiedDnps:[],stillPending:[],final:false};

  let pending=await unresolvedPlayers(baseUrl,serviceRoleKey,leagueId,gameweek);
  const playerFixture=new Map<number,WeekFixture>();
  for(const player of pending.players){
    const fixture=fixtureForPlayer(player,fixtures);
    if(fixture&&TERMINAL_FIXTURE_STATUSES.has(fixture.status))playerFixture.set(player.id,fixture);
  }
  const attemptedFixtures=[...new Set([...playerFixture.values()].map(fixture=>fixture.fixture_id))];
  let providerRows=0;

  if(attemptedFixtures.length){
    const candidates=await read<CachedFixture>(
      baseUrl,serviceRoleKey,
      `football_fixture_cache?fixture_id=in.(${attemptedFixtures.join(",")})&select=fixture_id,status,kickoff,events_synced_at`,
    );
    const snapshot=await fetchProviderSnapshot(candidates);
    const completedIds=snapshot.fixtures.filter(fixture=>TERMINAL_FIXTURE_STATUSES.has(fixture.fixture.status.short)).map(fixture=>fixture.fixture.id);
    const candidateById=new Map(candidates.map(candidate=>[candidate.fixture_id,candidate]));
    const eventIds=completedIds.filter(id=>!candidateById.get(id)?.events_synced_at);
    const ownGoals=await fetchProviderOwnGoals(eventIds);
    const apiIds=providerPlayerIds(snapshot.playerPages);
    const mappings=await store.playerMappings(apiIds);
    const internalByApiId=new Map(mappings.flatMap(mapping=>mapping.api_football_id===null?[]:[[mapping.api_football_id,mapping.id] as const]));
    const normalized=normalizeProviderPlayerPages(snapshot.playerPages,internalByApiId,ranAt,ownGoals.byFixtureAndApiPlayer);
    await store.insertObservations(normalized.observations);
    await store.upsertFixtureStats(normalized.rows,ranAt);
    await store.markFixtureEventsSynced(ownGoals.fixtureIdsSynced,ranAt);
    await store.reconcilePlayerClubs(normalized.clubAppearances);
    const kickoffById=new Map(snapshot.fixtures.map(fixture=>[fixture.fixture.id,fixture.fixture.date]));
    await store.reconcilePlayerAvailability(normalized.rows.flatMap(row=>{
      const kickoff=kickoffById.get(row.fixture_id);
      return Number(row.minutes)>0&&kickoff?[{player_id:row.player_id,kickoff}]:[];
    }));
    providerRows=normalized.rows.length;
    await rebuildLeagueWeek(store,leagueId,league,gameweek,fixtures,ranAt);

    pending=await unresolvedPlayers(baseUrl,serviceRoleKey,leagueId,gameweek);
    if(pending.players.length){
      const remainingFixtureIds=[...new Set(pending.players.map(player=>playerFixture.get(player.id)?.fixture_id).filter((id):id is number=>Boolean(id)))];
      const lineups=await fetchProviderLineups(remainingFixtureIds);
      const providerFixtureById=new Map(snapshot.fixtures.map(fixture=>[fixture.fixture.id,fixture]));
      const verifiedDnps:string[]=[];

      for(const player of pending.players){
        const fixture=playerFixture.get(player.id);
        const providerFixture=fixture?providerFixtureById.get(fixture.fixture_id):undefined;
        if(!fixture||!providerFixture||!player.api_football_id)continue;
        const club=norm(player.club);
        const teamId=norm(fixture.home_team)===club?providerFixture.teams.home.id:
          norm(fixture.away_team)===club?providerFixture.teams.away.id:null;
        if(!teamId)continue;
        const teamLineup=lineups.byFixtureId.get(fixture.fixture_id)?.find(lineup=>lineup.team.id===teamId);
        if(!teamLineup||teamLineup.startXI.length!==11)continue;
        const squadIds=new Set([...teamLineup.startXI,...teamLineup.substitutes].map(row=>row.player.id));
        if(squadIds.has(player.api_football_id))continue;
        await patch(
          baseUrl,serviceRoleKey,
          `league_player_scores?league_id=eq.${leagueId}&gameweek=eq.${gameweek}&player_id=eq.${player.id}`,
          {
            status:"final",stats_received:false,source:"api-football-verified-not-in-matchday-squad",
            source_updated_at:ranAt,updated_at:ranAt,rating:null,minutes:0,goals:0,assists:0,shots_on_target:0,
            big_chances_missed:0,completed_passes:0,tackles_won:0,penalty_goals:0,penalties_missed:0,
            penalties_conceded:0,saves:0,penalties_saved:0,goals_conceded:0,yellow_cards:0,second_yellow_cards:0,
            red_cards:0,own_goals:0,man_of_the_match:false,fantasy_points:0,score_ledger:[],calculator_version:"verified-dnp-v1",
          },
        );
        verifiedDnps.push(player.full_name);
      }

      await store.settleFinalGameweek(leagueId,gameweek);
      const after=await unresolvedPlayers(baseUrl,serviceRoleKey,leagueId,gameweek);
      const matchupState=await read<MatchupState>(baseUrl,serviceRoleKey,`league_matchups?league_id=eq.${leagueId}&gameweek=eq.${gameweek}&select=status`);
      return {
        leagueId,gameweek,attemptedFixtures,providerRows,verifiedDnps,
        stillPending:after.players.map(player=>player.full_name),
        final:matchupState.length>0&&matchupState.every(matchup=>matchup.status==="final"),
      };
    }
  }

  await store.settleFinalGameweek(leagueId,gameweek);
  const after=await unresolvedPlayers(baseUrl,serviceRoleKey,leagueId,gameweek);
  const matchupState=await read<MatchupState>(baseUrl,serviceRoleKey,`league_matchups?league_id=eq.${leagueId}&gameweek=eq.${gameweek}&select=status`);
  return {
    leagueId,gameweek,attemptedFixtures,providerRows,verifiedDnps:[],
    stillPending:after.players.map(player=>player.full_name),
    final:matchupState.length>0&&matchupState.every(matchup=>matchup.status==="final"),
  };
}

export async function GET(request:NextRequest){
  const secret=process.env.CRON_SECRET;
  if(!secret||request.headers.get("authorization")!==`Bearer ${secret}`)
    return NextResponse.json({error:"Unauthorized"},{status:401});
  const baseUrl=process.env.NEXT_PUBLIC_SUPABASE_URL??"https://ocabrgbrkqmsnalbfzvx.supabase.co";
  const serviceRoleKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!serviceRoleKey)return NextResponse.json({error:"Server database credential is not configured."},{status:503});

  const now=new Date();
  const store=new LiveScoreStore(baseUrl,serviceRoleKey);
  try{
    const matchupRows=await read<PendingMatchup>(baseUrl,serviceRoleKey,"league_matchups?status=neq.final&select=league_id,gameweek,status");
    const pendingWeeks=[...new Map(matchupRows.map(row=>[`${row.league_id}:${row.gameweek}`,{leagueId:row.league_id,gameweek:Number(row.gameweek)}])).values()];
    const results:RecoveryWeek[]=[];
    for(const week of pendingWeeks){
      const snapshot=await read<SnapshotPlayer>(baseUrl,serviceRoleKey,`lineup_gameweek_players?league_id=eq.${week.leagueId}&gameweek=eq.${week.gameweek}&select=player_id&limit=1`);
      if(!snapshot.length)continue;
      results.push(await recoverWeek(store,baseUrl,serviceRoleKey,week.leagueId,week.gameweek,now));
    }
    return NextResponse.json({ok:true,ranAt:now.toISOString(),weeksChecked:results.length,results});
  }catch(error){
    console.error("[cron/wrap-gameweeks] recovery failed",error);
    return NextResponse.json({error:error instanceof Error?error.message:"Gameweek wrap recovery failed."},{status:502});
  }
}
