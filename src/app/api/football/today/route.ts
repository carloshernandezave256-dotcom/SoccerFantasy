import { NextRequest, NextResponse } from "next/server";

const competitions=[
  {id:39,name:"Premier League"},{id:140,name:"La Liga"},{id:135,name:"Serie A"},{id:78,name:"Bundesliga"},{id:61,name:"Ligue 1"},
];

const betaFixture={id:20240817,competition:"Premier League",match:"2024 opening-weekend beta test",status:"FT"};
const betaPlayers=[
  {name:"Bukayo Saka",club:"Arsenal",minutes:90,goals:1,assists:1,shotsOnTarget:2,completedPasses:30,tacklesWon:1,goalsConceded:0},
  {name:"Martin Odegaard",club:"Arsenal",minutes:90,goals:0,assists:0,shotsOnTarget:1,completedPasses:42,tacklesWon:1,goalsConceded:0},
  {name:"William Saliba",club:"Arsenal",minutes:90,goals:0,assists:0,shotsOnTarget:0,completedPasses:71,tacklesWon:1,goalsConceded:0},
  {name:"Gabriel Magalhaes",club:"Arsenal",minutes:90,goals:0,assists:0,shotsOnTarget:0,completedPasses:58,tacklesWon:2,goalsConceded:0},
  {name:"Mohamed Salah",club:"Liverpool",minutes:90,goals:1,assists:1,shotsOnTarget:3,completedPasses:24,tacklesWon:0,goalsConceded:0},
  {name:"Alisson",club:"Liverpool",minutes:90,goals:0,assists:0,shotsOnTarget:0,completedPasses:28,tacklesWon:0,saves:2,goalsConceded:0},
  {name:"Virgil van Dijk",club:"Liverpool",minutes:90,goals:0,assists:0,shotsOnTarget:0,completedPasses:93,tacklesWon:1,goalsConceded:0},
  {name:"Trent Alexander-Arnold",club:"Liverpool",minutes:77,goals:0,assists:0,shotsOnTarget:0,completedPasses:44,tacklesWon:1,goalsConceded:0},
  {name:"Anthony Gordon",club:"Newcastle",minutes:90,goals:0,assists:0,shotsOnTarget:1,completedPasses:12,tacklesWon:1,goalsConceded:0},
  {name:"Lamine Yamal",club:"Barcelona",minutes:86,goals:0,assists:1,shotsOnTarget:1,completedPasses:24,tacklesWon:1,goalsConceded:1},
].map((player,index)=>({apiPlayerId:900000+index,competition:betaFixture.competition,fixtureId:betaFixture.id,fixture:betaFixture.match,kickoff:"2024-08-17T12:00:00Z",status:"final",position:null,bigChancesMissed:0,penaltyGoals:0,penaltiesMissed:0,penaltiesConceded:0,saves:0,penaltiesSaved:0,yellowCards:0,secondYellowCards:0,redCards:0,ownGoals:0,manOfTheMatch:false,...player}));

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
  const year=Number(date.slice(0,4)),month=Number(date.slice(5,7));
  const season=month<=6?year-1:year;
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
  }catch(error){
    if(date==="2024-08-17")return NextResponse.json({date,requestsUsed:competitions.length,fixtures:[betaFixture],players:betaPlayers,isBetaFallback:true,limitations:["API-Football's free tier currently has no overlap between its permitted seasons and permitted date window, so this uses a curated beta dataset for drafted players who played on August 17, 2024.","This dataset validates scoring, score import, and player profiles; it is not an official historical-stat feed.","Man of the Match and big chances missed use zero in this test."]});
    return NextResponse.json({error:error instanceof Error?error.message:"API-Football request failed."},{status:502});
  }
}
