import {NextRequest,NextResponse} from "next/server";
import {apiFootball,playerHeadshot} from "@/lib/api-football-server";

const competitions=[{id:39,name:"Premier League"},{id:140,name:"La Liga"},{id:135,name:"Serie A"},{id:78,name:"Bundesliga"},{id:61,name:"Ligue 1"}];
type ApiStat={team:{name:string};games:{position:string|null;appearences?:number|null;minutes?:number|null;rating?:string|null}};
type ApiEntry={player:{id:number;name:string;firstname?:string|null;lastname?:string|null;nationality:string|null;photo:string|null};statistics:ApiStat[]};
type ApiPage={paging:{current:number;total:number};response:ApiEntry[]};

export const maxDuration=300;

function bestStat(entry:ApiEntry){
  return [...entry.statistics].sort((a,b)=>(b.games.minutes??0)-(a.games.minutes??0)||(b.games.appearences??0)-(a.games.appearences??0))[0];
}
function performance(stat:ApiStat){
  const rating=Number(stat.games.rating)||0,minutes=stat.games.minutes??0,apps=stat.games.appearences??0;
  return rating*100+minutes+apps*90;
}

export async function POST(request:NextRequest){
  const authorization=request.headers.get("authorization")??"";
  if(!authorization.startsWith("Bearer "))return NextResponse.json({error:"Sign in is required."},{status:401});
  const supabaseUrl=process.env.NEXT_PUBLIC_SUPABASE_URL??"https://ocabrgbrkqmsnalbfzvx.supabase.co";
  const publishableKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY??"sb_publishable_DA08c5KwmYXpru6CdrRfHA_4Qe2z3M-";
  const serviceRoleKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!serviceRoleKey)return NextResponse.json({error:"Server database credential is not configured."},{status:503});
  const userHeaders={apikey:publishableKey,Authorization:authorization,"Content-Type":"application/json"};
  const adminHeaders={apikey:serviceRoleKey,Authorization:`Bearer ${serviceRoleKey}`,"Content-Type":"application/json"};
  const leaguesResponse=await fetch(`${supabaseUrl}/rest/v1/rpc/my_leagues`,{method:"POST",headers:userHeaders,body:"{}",cache:"no-store"});
  const leagues=leaguesResponse.ok?await leaguesResponse.json():[];
  if(!leagues.some((league:{is_commissioner:boolean})=>league.is_commissioner))return NextResponse.json({error:"Commissioner access required."},{status:403});

  const season=2026,seasonsUsed:Record<string,number>={},unavailable:string[]=[];
  const eligibleApiIds:number[]=[];
  let imported=0,requestsUsed=0;
  for(const competition of competitions){
    let page=1,total=1;
    const entries:ApiEntry[]=[];
    while(page<=total){
      const body=await apiFootball<ApiPage>(`players?league=${competition.id}&season=${season}&page=${page}`);requestsUsed++;
      if(page===1&&body.response.length===0){unavailable.push(competition.name);break}
      total=body.paging.total;entries.push(...body.response);page++;
    }
    if(entries.length===0)continue;
    seasonsUsed[competition.name]=season;
    const byClub=new Map<string,Array<{entry:ApiEntry;stat:ApiStat;score:number}>>();
    for(const entry of entries){
      const stat=bestStat(entry);if(!stat?.team?.name)continue;
      const row={entry,stat,score:performance(stat)};
      byClub.set(stat.team.name,[...(byClub.get(stat.team.name)??[]),row]);
    }
    const selected=[...byClub.values()].flatMap(players=>players.sort((a,b)=>b.score-a.score||a.entry.player.name.localeCompare(b.entry.player.name)).slice(0,25))
      .sort((a,b)=>b.score-a.score||a.entry.player.name.localeCompare(b.entry.player.name));
    const players=selected.map(({entry,stat},index)=>{
      const officialName=[entry.player.firstname,entry.player.lastname].filter(Boolean).join(" ").trim()||entry.player.name;
      eligibleApiIds.push(entry.player.id);
      return {apiFootballId:entry.player.id,fullName:officialName,nationality:entry.player.nationality,photoUrl:entry.player.photo??playerHeadshot(entry.player.id),position:stat.games.position??"Attacker",club:stat.team.name,competition:competition.name,draftRank:index+1};
    });
    for(let index=0;index<players.length;index+=500){
      const response=await fetch(`${supabaseUrl}/rest/v1/rpc/sync_api_football_players`,{method:"POST",headers:userHeaders,body:JSON.stringify({p_players:players.slice(index,index+500)}),cache:"no-store"});
      if(!response.ok)throw new Error((await response.text())||"Player database sync failed");
      imported+=Number(await response.json())||0;
    }
  }
  if(eligibleApiIds.length===0)return NextResponse.json({error:"The 2026 API season returned no eligible players.",season,unavailable,requestsUsed},{status:502});
  const finalizeResponse=await fetch(`${supabaseUrl}/rest/v1/rpc/finalize_api_football_draft_pool`,{method:"POST",headers:adminHeaders,body:JSON.stringify({p_api_ids:eligibleApiIds}),cache:"no-store"});
  if(!finalizeResponse.ok)throw new Error((await finalizeResponse.text())||"Draft pool finalization failed");
  const eligible=Number(await finalizeResponse.json())||0;
  return NextResponse.json({ok:true,season,seasonsUsed,unavailable,imported,eligible,clubLimit:25,requestsUsed});
}
