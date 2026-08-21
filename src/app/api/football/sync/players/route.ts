import {NextRequest,NextResponse} from "next/server";
import {apiFootball,playerHeadshot} from "@/lib/api-football-server";
import {isDeveloperRequest} from "@/lib/developer-auth";

const competitions=[{id:39,name:"Premier League"},{id:140,name:"La Liga"},{id:135,name:"Serie A"},{id:78,name:"Bundesliga"},{id:61,name:"Ligue 1"}];
type ApiStat={team:{id:number;name:string};games:{position:string|null;appearences?:number|null;minutes?:number|null;rating?:string|null}};
type ApiEntry={player:{id:number;name:string;firstname?:string|null;lastname?:string|null;nationality:string|null;photo:string|null};statistics:ApiStat[]};
type ApiPage={paging:{current:number;total:number};response:ApiEntry[]};
type TeamsPage={response:Array<{team:{id:number;name:string}}>} ;
type SquadPlayer={id:number;name:string;position:string;photo:string|null};
type SquadPage={response:Array<{team:{id:number;name:string};players:SquadPlayer[]}>};
type InjuryEntry={player:{id:number;name:string;type?:string|null;reason?:string|null};team:{id:number;name:string}};
type InjuriesPage={response:InjuryEntry[]};
type SidelinedEntry={type?:string|null;start?:string|null;end?:string|null};
type SidelinedPage={response:SidelinedEntry[]};
type ExistingInjury={api_football_id:number;injured:boolean;injury_type:string|null;injury_reason:string|null;expected_return:string|null;sidelined_checked_at:string|null};

export const maxDuration=300;

function bestStat(entry:ApiEntry){
  return [...entry.statistics].sort((a,b)=>(b.games.minutes??0)-(a.games.minutes??0)||(b.games.appearences??0)-(a.games.appearences??0))[0];
}
function performance(stat:ApiStat|undefined){
  if(!stat)return 0;
  const rating=Number(stat.games.rating)||0,minutes=stat.games.minutes??0,apps=stat.games.appearences??0;
  return rating*100+minutes+apps*90;
}
function expectedReturn(rows:SidelinedEntry[]){
  const today=new Date().toISOString().slice(0,10);
  const latest=[...rows].sort((a,b)=>String(b.start??"").localeCompare(String(a.start??"")))[0];
  const end=latest?.end?.trim();
  return end&&/^\d{4}-\d{2}-\d{2}$/.test(end)&&end>=today?end:null;
}
function shouldRefreshSidelined(existing:ExistingInjury|undefined,type:string,reason:string|null){
  if(!existing?.injured)return true;
  if((existing.injury_type??"")!==type||(existing.injury_reason??null)!==reason)return true;
  if(!existing.sidelined_checked_at)return true;
  const checkedAt=new Date(existing.sidelined_checked_at).getTime();
  if(!Number.isFinite(checkedAt))return true;
  const day=24*60*60*1000;
  if(Date.now()-checkedAt<day)return false;
  if(!existing.expected_return)return true;
  const returnAt=new Date(`${existing.expected_return}T00:00:00Z`).getTime();
  return Number.isFinite(returnAt)&&returnAt<=Date.now()+2*day;
}

export async function POST(request:NextRequest){
  const authorization=request.headers.get("authorization")??"";
  if(!authorization.startsWith("Bearer "))return NextResponse.json({error:"Sign in is required."},{status:401});
  if(!await isDeveloperRequest(request))return NextResponse.json({error:"Developer access required."},{status:403});
  const supabaseUrl=process.env.NEXT_PUBLIC_SUPABASE_URL??"https://ocabrgbrkqmsnalbfzvx.supabase.co";
  const serviceRoleKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!serviceRoleKey)return NextResponse.json({error:"Server database credential is not configured."},{status:503});
  const adminHeaders={apikey:serviceRoleKey,Authorization:`Bearer ${serviceRoleKey}`,"Content-Type":"application/json"};
  const season=2026,rankingSeason=2025,seasonsUsed:Record<string,number>={},unavailable:string[]=[],injuriesUnavailable:string[]=[];
  const eligiblePlayers:Array<{id:number;score:number}>=[];
  let imported=0,requestsUsed=0,injuriesSynced=0,sidelinedLookups=0,sidelinedCacheHits=0;
  for(const competition of competitions){
    const priorById=new Map<number,{entry:ApiEntry;score:number}>();
    let page=1,total=1;
    while(page<=total){
      const body=await apiFootball<ApiPage>(`players?league=${competition.id}&season=${rankingSeason}&page=${page}`);requestsUsed++;
      total=body.paging.total;
      for(const entry of body.response){const stat=bestStat(entry),score=performance(stat),current=priorById.get(entry.player.id);if(!current||score>current.score)priorById.set(entry.player.id,{entry,score})}
      page++;
    }
    const teams=await apiFootball<TeamsPage>(`teams?league=${competition.id}&season=${season}`);requestsUsed++;
    if(!teams.response.length){unavailable.push(competition.name);continue}
    const squadResponses:SquadPage[]=[];
    for(const {team} of teams.response){squadResponses.push(await apiFootball<SquadPage>(`players/squads?team=${team.id}`));requestsUsed++}
    const selected=squadResponses.flatMap(body=>body.response.flatMap(squad=>{
      return [...squad.players].sort((a,b)=>(priorById.get(b.id)?.score??0)-(priorById.get(a.id)?.score??0)||a.name.localeCompare(b.name))
        .map(player=>({player,team:squad.team,score:priorById.get(player.id)?.score??0,prior:priorById.get(player.id)?.entry}));
    })).sort((a,b)=>b.score-a.score||a.player.name.localeCompare(b.player.name));
    if(!selected.length){unavailable.push(competition.name);continue}
    seasonsUsed[competition.name]=season;
    const players=selected.map(({player,team,prior,score},index)=>{
      const officialName=prior?[prior.player.firstname,prior.player.lastname].filter(Boolean).join(" ").trim()||player.name:player.name;
      eligiblePlayers.push({id:player.id,score});
      return {apiFootballId:player.id,fullName:officialName,nationality:prior?.player.nationality??null,photoUrl:player.photo??prior?.player.photo??playerHeadshot(player.id),position:player.position,club:team.name,competition:competition.name,draftRank:index+1};
    });
    for(let index=0;index<players.length;index+=500){
      const response=await fetch(`${supabaseUrl}/rest/v1/rpc/sync_api_football_players`,{method:"POST",headers:adminHeaders,body:JSON.stringify({p_players:players.slice(index,index+500)}),cache:"no-store"});
      if(!response.ok)throw new Error((await response.text())||"Player database sync failed");
      imported+=Number(await response.json())||0;
    }

    try{
      const injuryBody=await apiFootball<InjuriesPage>(`injuries?league=${competition.id}&season=${season}`);requestsUsed++;
      const existingResponse=await fetch(`${supabaseUrl}/rest/v1/players?competition=eq.${encodeURIComponent(competition.name)}&select=api_football_id,injured,injury_type,injury_reason,expected_return,sidelined_checked_at`,{headers:adminHeaders,cache:"no-store"});
      if(!existingResponse.ok)throw new Error((await existingResponse.text())||"Could not load cached injury statuses");
      const existingRows=await existingResponse.json() as ExistingInjury[];
      const existingById=new Map(existingRows.filter(row=>row.api_football_id).map(row=>[row.api_football_id,row]));
      const clearResponse=await fetch(`${supabaseUrl}/rest/v1/players?competition=eq.${encodeURIComponent(competition.name)}`,{method:"PATCH",headers:{...adminHeaders,Prefer:"return=minimal"},body:JSON.stringify({injured:false,injury_type:null,injury_reason:null,expected_return:null,injury_updated_at:new Date().toISOString(),sidelined_checked_at:null}),cache:"no-store"});
      if(!clearResponse.ok)throw new Error((await clearResponse.text())||"Could not clear stale injury statuses");
      const currentByPlayer=[...new Map(injuryBody.response.map(entry=>[entry.player.id,entry])).values()];
      for(const injury of currentByPlayer){
        const injuryType=injury.player.type??"Injury";
        const injuryReason=injury.player.reason??null;
        const existing=existingById.get(injury.player.id);
        const refreshSidelined=shouldRefreshSidelined(existing,injuryType,injuryReason);
        let returnDate=existing?.expected_return??null;
        let checkedAt=existing?.sidelined_checked_at??null;
        if(refreshSidelined){
          try{
            const sidelined=await apiFootball<SidelinedPage>(`sidelined?player=${injury.player.id}`);requestsUsed++;sidelinedLookups++;
            returnDate=expectedReturn(sidelined.response);
            checkedAt=new Date().toISOString();
          }catch{
            // Current injury data remains useful even when historical/return-date coverage is unavailable.
          }
        }else sidelinedCacheHits++;
        const injuryResponse=await fetch(`${supabaseUrl}/rest/v1/players?api_football_id=eq.${injury.player.id}`,{method:"PATCH",headers:{...adminHeaders,Prefer:"return=minimal"},body:JSON.stringify({injured:true,injury_type:injuryType,injury_reason:injuryReason,expected_return:returnDate,injury_updated_at:new Date().toISOString(),sidelined_checked_at:checkedAt}),cache:"no-store"});
        if(!injuryResponse.ok)throw new Error((await injuryResponse.text())||"Could not save player injury status");
        injuriesSynced++;
      }
    }catch{
      injuriesUnavailable.push(competition.name);
    }
  }
  const uniqueEligible=[...new Map(eligiblePlayers.sort((a,b)=>b.score-a.score||a.id-b.id).map(player=>[player.id,player])).values()].map(player=>player.id);
  if(uniqueEligible.length===0)return NextResponse.json({error:"The API returned no current 2026 squad players.",season,rankingSeason,unavailable,requestsUsed},{status:502});
  const finalizeResponse=await fetch(`${supabaseUrl}/rest/v1/rpc/finalize_api_football_draft_pool`,{method:"POST",headers:adminHeaders,body:JSON.stringify({p_api_ids:uniqueEligible}),cache:"no-store"});
  if(!finalizeResponse.ok)throw new Error((await finalizeResponse.text())||"Draft pool finalization failed");
  const eligible=Number(await finalizeResponse.json())||0;
  return NextResponse.json({ok:true,season,rankingSeason,seasonsUsed,unavailable,imported,eligible,clubLimit:null,requestsUsed,injuriesSynced,sidelinedLookups,sidelinedCacheHits,injuriesUnavailable});
}
