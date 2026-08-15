import { NextRequest, NextResponse } from "next/server";

const competitions=[
  {id:39,name:"Premier League"},{id:140,name:"La Liga"},{id:135,name:"Serie A"},{id:78,name:"Bundesliga"},{id:61,name:"Ligue 1"},
];

type ApiPlayer={player:{id:number;name:string};statistics:Array<{team:{id:number;name:string};league:{id:number;name:string};games:{minutes:number|null;position:string|null};shots:{on:number|null};goals:{total:number|null;assists:number|null;conceded:number|null;saves:number|null};passes:{total:number|null;accuracy:number|string|null};tackles:{total:number|null};cards:{yellow:number|null;red:number|null};penalty:{scored:number|null;missed:number|null;saved:number|null;commited:number|null}}>};

async function football(path:string,key:string){
  const response=await fetch(`https://v3.football.api-sports.io/${path}`,{headers:{"x-apisports-key":key},cache:"no-store"});
  if(!response.ok)throw new Error(`API-Football returned ${response.status}`);
  const body=await response.json();
  if(body.errors&&Object.keys(body.errors).length)throw new Error(Object.values(body.errors).join(", "));
  return body.response??[];
}

export async function GET(request:NextRequest){
  const key=process.env.API_FOOTBALL_KEY;
  const supabaseUrl=process.env.NEXT_PUBLIC_SUPABASE_URL??"https://ocabrgbrkqmsnalbfzvx.supabase.co";
  const publishableKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY??"sb_publishable_DA08c5KwmYXpru6CdrRfHA_4Qe2z3M-";
  if(!key)return NextResponse.json({error:"API_FOOTBALL_KEY is not configured for this deployment."},{status:503});
  const authorization=request.headers.get("authorization")??"";
  if(!authorization.startsWith("Bearer "))return NextResponse.json({error:"Sign in is required."},{status:401});
  const userResponse=await fetch(`${supabaseUrl}/auth/v1/user`,{headers:{apikey:publishableKey,Authorization:authorization},cache:"no-store"});
  if(!userResponse.ok)return NextResponse.json({error:"Your session has expired."},{status:401});
  const user=await userResponse.json();
  const leaguesResponse=await fetch(`${supabaseUrl}/rest/v1/rpc/my_leagues`,{method:"POST",headers:{apikey:publishableKey,Authorization:authorization,"Content-Type":"application/json"},body:"{}",cache:"no-store"});
  const leagues=leaguesResponse.ok?await leaguesResponse.json():[];
  const leagueId=request.nextUrl.searchParams.get("league");
  if(!leagues.some((league:{league_id:string;is_commissioner:boolean})=>league.league_id===leagueId&&league.is_commissioner))return NextResponse.json({error:"Only this league’s commissioner can run an API test."},{status:403});
  const date=request.nextUrl.searchParams.get("date")??new Intl.DateTimeFormat("en-CA",{timeZone:"America/Los_Angeles",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  const season=Number(date.slice(0,4));
  try{
    const fixtureGroups=await Promise.all(competitions.map(async competition=>({competition,fixtures:await football(`fixtures?league=${competition.id}&season=${season}&date=${date}&timezone=America%2FLos_Angeles`,key)})));
    const fixtures=fixtureGroups.flatMap(group=>group.fixtures.map((fixture:{fixture:{id:number;date:string;status:{short:string}};teams:{home:{name:string};away:{name:string}}})=>({...fixture,competition:group.competition.name}))).filter(fixture=>!["TBD","NS","PST","CANC","ABD","AWD","WO"].includes(fixture.fixture.status.short));
    const playerGroups=await Promise.all(fixtures.map(async fixture=>({fixture,teams:await football(`fixtures/players?fixture=${fixture.fixture.id}`,key)})));
    const players=playerGroups.flatMap(({fixture,teams})=>(teams as Array<{players:ApiPlayer[]}>).flatMap(team=>team.players.flatMap(entry=>entry.statistics.slice(0,1).map(stat=>{
      const accuracy=Number(String(stat.passes.accuracy??"0").replace("%",""))||0;
      const minutes=stat.games.minutes??0;
      return {apiPlayerId:entry.player.id,name:entry.player.name,club:stat.team.name,competition:fixture.competition,fixtureId:fixture.fixture.id,fixture:`${fixture.teams.home.name} vs ${fixture.teams.away.name}`,kickoff:fixture.fixture.date,status:["FT","AET","PEN"].includes(fixture.fixture.status.short)?"final":"live",position:stat.games.position,minutes,goals:stat.goals.total??0,assists:stat.goals.assists??0,shotsOnTarget:stat.shots.on??0,bigChancesMissed:0,completedPasses:Math.round((stat.passes.total??0)*accuracy/100),tacklesWon:stat.tackles.total??0,penaltyGoals:stat.penalty.scored??0,penaltiesMissed:stat.penalty.missed??0,penaltiesConceded:stat.penalty.commited??0,saves:stat.goals.saves??0,penaltiesSaved:stat.penalty.saved??0,goalsConceded:stat.goals.conceded??0,yellowCards:stat.cards.yellow??0,secondYellowCards:0,redCards:stat.cards.red??0,ownGoals:0,manOfTheMatch:false};
    }))));
    return NextResponse.json({date,requestsUsed:competitions.length+fixtures.length,fixtures:fixtures.map(f=>({id:f.fixture.id,competition:f.competition,match:`${f.teams.home.name} vs ${f.teams.away.name}`,status:f.fixture.status.short})),players,limitations:["Completed passes are estimated from total passes and API accuracy.","API-Football does not provide big chances missed in fixture player statistics, so the preview uses zero.","Man of the Match remains manual and is not included in this preview."]});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"API-Football request failed."},{status:502})}
}
