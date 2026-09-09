import {NextRequest,NextResponse} from "next/server";
import {isDeveloperRequest} from "@/lib/developer-auth";
import {
  FOTMOB_LEAGUE_IDS,
  matchFotmobAvailabilityPlayer,
  parseFotmobTeamAvailability,
  resolveFotmobClubIds,
  type AvailabilityPlayer,
} from "@/lib/fotmob-availability";
import {fotmobConfirmsActive,fotmobReturnUpdate,recentFotmobClearBlocksInjury} from "@/lib/fotmob-return-update";
import {appearanceDisprovesInjury} from "@/lib/injury-observation";

type InjuryPlayer={
  id:number;
  full_name:string;
  club:string;
  competition:string;
  injured:boolean;
  injury_type:string|null;
  injury_reason:string|null;
  expected_return:string|null;
  injury_updated_at:string|null;
  availability_last_appearance_at:string|null;
  fotmob_id:number|null;
  fotmob_expected_return:string|null;
  fotmob_return_checked_at:string|null;
};

type SearchCandidate={id:number;name:string;raw:unknown};

export const maxDuration=300;

function normalize(value:string){
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim();
}
function tokens(value:string){return normalize(value).split(" ").filter(Boolean)}

function isConfirmedInjury(player:InjuryPlayer){
  const value=`${player.injury_type??""} ${player.injury_reason??""}`.toLowerCase();
  if(/suspend|red card|yellow card|coach|inactive|rest|transfer|loan agreement|match fitness/.test(value))return false;
  return /injur|illness|health|hernia|strain|sprain|fracture|broken|achilles|hamstring|thigh|groin|knee|ankle|foot|calf|muscle|shoulder|back|hip|rib|arm|finger|wrist|leg|fotmob/.test(value);
}

function freshEnough(player:InjuryPlayer){
  if(!player.fotmob_id||!player.fotmob_return_checked_at)return false;
  const checked=new Date(player.fotmob_return_checked_at).getTime();
  return Number.isFinite(checked)&&Date.now()-checked<12*60*60*1000;
}

async function fotmobJson(path:string){
  const urls=[`https://www.fotmob.com/api/data/${path}`,`https://www.fotmob.com/api/${path}`];
  let lastError="FotMob request failed";
  for(const url of urls){
    try{
      const response=await fetch(url,{headers:{"User-Agent":"Mozilla/5.0 (compatible; MyFantasyXI/1.0)",Accept:"application/json"},cache:"no-store"});
      if(response.ok)return await response.json() as unknown;
      lastError=`FotMob ${response.status}`;
    }catch(error){lastError=error instanceof Error?error.message:lastError}
  }
  throw new Error(lastError);
}

function searchCandidates(value:unknown){
  const candidates:SearchCandidate[]=[];
  const visit=(node:unknown)=>{
    if(Array.isArray(node)){node.forEach(visit);return}
    if(!node||typeof node!=="object")return;
    const record=node as Record<string,unknown>;
    const id=Number(record.id??record.playerId??record.player_id);
    const name=String(record.name??record.title??record.playerName??record.fullName??"").trim();
    const type=String(record.type??record.entityType??record.category??"").toLowerCase();
    const url=String(record.url??record.pageUrl??record.path??"").toLowerCase();
    if(Number.isFinite(id)&&id>0&&name&&(type.includes("player")||url.includes("/players/")))candidates.push({id,name,raw:node});
    Object.values(record).forEach(visit);
  };
  visit(value);
  return [...new Map(candidates.map(candidate=>[candidate.id,candidate])).values()];
}

function scoreCandidate(player:InjuryPlayer,candidate:SearchCandidate){
  const wanted=tokens(player.full_name),candidateTokens=tokens(candidate.name),club=normalize(player.club),raw=normalize(JSON.stringify(candidate.raw));
  const wantedJoined=wanted.join(""),candidateJoined=candidateTokens.join("");
  const surname=wanted[wanted.length-1]??"",candidateSurname=candidateTokens[candidateTokens.length-1]??"";
  const first=wanted[0]??"",candidateFirst=candidateTokens[0]??"";
  let score=0;
  if(candidateJoined===wantedJoined)score+=160;
  else if(candidateJoined.includes(wantedJoined)||wantedJoined.includes(candidateJoined))score+=95;
  if(surname&&candidateSurname===surname)score+=90;
  else if(surname&&candidateTokens.includes(surname))score+=65;
  if(first.length===1&&candidateFirst.startsWith(first))score+=35;
  else if(first.length>1&&candidateFirst===first)score+=45;
  if(club&&raw.includes(club))score+=70;
  return score;
}

async function searchFotmob(term:string){
  const query=encodeURIComponent(term);
  let payload:unknown;
  try{payload=await fotmobJson(`search/suggest?hits=20&lang=en&term=${query}`)}
  catch{payload=await fotmobJson(`searchData?term=${query}`)}
  return searchCandidates(payload);
}

async function findFotmobId(player:InjuryPlayer){
  const nameTokens=tokens(player.full_name),surname=nameTokens[nameTokens.length-1]??player.full_name;
  const terms=[player.full_name,surname,`${surname} ${player.club}`];
  const all:SearchCandidate[]=[];
  for(const term of [...new Set(terms.filter(Boolean))]){
    try{all.push(...await searchFotmob(term))}catch{}
  }
  const candidates=[...new Map(all.map(candidate=>[candidate.id,candidate])).values()];
  if(!candidates.length)return null;
  const ranked=candidates.map(candidate=>({...candidate,score:scoreCandidate(player,candidate)})).sort((a,b)=>b.score-a.score);
  return ranked[0]&&ranked[0].score>=120?ranked[0].id:null;
}

function expectedReturnFromPayload(value:unknown){
  const directStrings:string[]=[];
  const objectValues:string[]=[];
  const visit=(node:unknown)=>{
    if(Array.isArray(node)){node.forEach(visit);return}
    if(!node||typeof node!=="object")return;
    const record=node as Record<string,unknown>;
    for(const [key,item] of Object.entries(record)){
      const compact=key.toLowerCase().replace(/[^a-z]/g,"");
      if(compact.includes("expectedreturn")){
        if(typeof item==="string"&&item.trim())directStrings.push(item.trim());
        else if(item&&typeof item==="object"){
          const obj=item as Record<string,unknown>;
          for(const preferred of ["expectedReturnFallback","expectedReturnDateParam","date","value","label","text"]){
            const candidate=obj[preferred];
            if(typeof candidate==="string"&&candidate.trim())objectValues.push(candidate.trim());
          }
        }
      }
      visit(item);
    }
  };
  visit(value);
  const values=[...objectValues,...directStrings].map(value=>value.replace(/^Expected return:\s*/i,"").trim()).filter(Boolean);
  return values.find(value=>!/unknown|n\/a|null/i.test(value))??null;
}

async function enrichPlayer(player:InjuryPlayer,supabaseUrl:string,adminHeaders:Record<string,string>){
  if(freshEnough(player))return {cached:true,matched:true,dated:Boolean(player.fotmob_expected_return)};
  let fotmobId=player.fotmob_id;
  if(!fotmobId)fotmobId=await findFotmobId(player);
  let returnLabel:string|null=player.fotmob_expected_return??null;
  if(fotmobId){
    try{returnLabel=expectedReturnFromPayload(await fotmobJson(`playerData?id=${fotmobId}&includeMarketValues=false`))}
    catch{returnLabel=player.fotmob_expected_return??null}
  }
  const response=await fetch(`${supabaseUrl}/rest/v1/players?id=eq.${player.id}`,{
    method:"PATCH",
    headers:{...adminHeaders,Prefer:"return=minimal"},
    body:JSON.stringify(fotmobReturnUpdate(fotmobId,returnLabel,new Date().toISOString())),
    cache:"no-store",
  });
  if(!response.ok)throw new Error((await response.text())||"Could not save FotMob return date");
  return {cached:false,matched:Boolean(fotmobId),dated:Boolean(returnLabel)};
}

async function patchPlayer(supabaseUrl:string,adminHeaders:Record<string,string>,playerId:number,body:Record<string,unknown>){
  const response=await fetch(`${supabaseUrl}/rest/v1/players?id=eq.${playerId}`,{
    method:"PATCH",
    headers:{...adminHeaders,Prefer:"return=minimal"},
    body:JSON.stringify(body),
    cache:"no-store",
  });
  if(!response.ok)throw new Error((await response.text())||"Could not save FotMob availability status");
}

async function syncFotmobAvailabilityBackup(supabaseUrl:string,adminHeaders:Record<string,string>){
  const select=[
    "id","full_name","club","competition","injured","injury_type","injury_reason","expected_return",
    "injury_updated_at","availability_last_appearance_at","fotmob_id","fotmob_expected_return","fotmob_return_checked_at",
  ].join(",");
  const response=await fetch(`${supabaseUrl}/rest/v1/players?active=eq.true&select=${select}&order=draft_rank.asc.nullslast`,{headers:adminHeaders,cache:"no-store"});
  if(!response.ok)throw new Error((await response.text())||"Could not load active players for FotMob availability backup");
  const activePlayers=await response.json() as InjuryPlayer[];
  const observedAt=new Date().toISOString();
  let requestsUsed=0,clubsResolved=0,clubsChecked=0,playersFlagged=0,playersMatched=0,unmatchedReports=0;
  const unavailableCompetitions:string[]=[];
  const unresolvedClubs:string[]=[];

  for(const [competition,leagueId] of Object.entries(FOTMOB_LEAGUE_IDS)){
    const competitionPlayers=activePlayers.filter(player=>player.competition===competition);
    if(!competitionPlayers.length)continue;
    const clubs=[...new Set(competitionPlayers.map(player=>player.club).filter(Boolean))];
    let leaguePayload:unknown;
    try{leaguePayload=await fotmobJson(`leagues?id=${leagueId}`);requestsUsed++}
    catch{unavailableCompetitions.push(competition);continue}
    const clubIds=resolveFotmobClubIds(leaguePayload,clubs);
    clubsResolved+=clubIds.size;
    unresolvedClubs.push(...clubs.filter(club=>!clubIds.has(club)).map(club=>`${competition}: ${club}`));
    const entries=[...clubIds.entries()];

    for(let index=0;index<entries.length;index+=4){
      const batch=entries.slice(index,index+4);
      const payloads=await Promise.all(batch.map(async([club,teamId])=>{
        try{return {club,payload:await fotmobJson(`teams?id=${teamId}`),ok:true}}
        catch{return {club,payload:null,ok:false}}
      }));
      requestsUsed+=batch.length;
      for(const item of payloads){
        if(!item.ok||!item.payload)continue;
        clubsChecked++;
        const clubPlayers=competitionPlayers.filter(player=>player.club===item.club) as AvailabilityPlayer[];
        for(const availability of parseFotmobTeamAvailability(item.payload)){
          const matched=matchFotmobAvailabilityPlayer(availability,clubPlayers);
          if(!matched){unmatchedReports++;continue}
          const player=competitionPlayers.find(candidate=>candidate.id===matched.id);
          if(!player)continue;
          playersMatched++;
          if(fotmobConfirmsActive(player.fotmob_expected_return))continue;
          if(recentFotmobClearBlocksInjury(player.injured,player.fotmob_return_checked_at))continue;
          const injuryType=availability.kind==="suspension"?"Suspension":"FotMob";
          const injuryReason=availability.reason||"Injury";
          if(appearanceDisprovesInjury(player,injuryType,injuryReason))continue;
          const update:Record<string,unknown>={
            injured:true,
            fotmob_id:availability.fotmobId,
          };
          if(!player.injured){
            update.injury_type=injuryType;
            update.injury_reason=injuryReason;
            update.injury_updated_at=observedAt;
          }
          if(availability.expectedReturn){
            update.fotmob_expected_return=availability.expectedReturn;
            update.fotmob_return_checked_at=observedAt;
          }
          await patchPlayer(supabaseUrl,adminHeaders,player.id,update);
          if(!player.injured)playersFlagged++;
        }
      }
    }
  }

  return {requestsUsed,clubsResolved,clubsChecked,playersFlagged,playersMatched,unmatchedReports,unavailableCompetitions,unresolvedClubs};
}

export async function POST(request:NextRequest){
  const authorization=request.headers.get("authorization")??"";
  const cronSecret=process.env.CRON_SECRET;
  const cronAuthorized=Boolean(cronSecret&&authorization===`Bearer ${cronSecret}`);
  if(!cronAuthorized){
    if(!authorization.startsWith("Bearer "))return NextResponse.json({error:"Sign in is required."},{status:401});
    if(!await isDeveloperRequest(request))return NextResponse.json({error:"Developer access required."},{status:403});
  }
  const supabaseUrl=process.env.NEXT_PUBLIC_SUPABASE_URL??"https://ocabrgbrkqmsnalbfzvx.supabase.co";
  const serviceRoleKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!serviceRoleKey)return NextResponse.json({error:"Server database credential is not configured."},{status:503});
  const adminHeaders={apikey:serviceRoleKey,Authorization:`Bearer ${serviceRoleKey}`,"Content-Type":"application/json"};

  let backup;
  try{backup=await syncFotmobAvailabilityBackup(supabaseUrl,adminHeaders)}
  catch(error){return NextResponse.json({error:error instanceof Error?error.message:"FotMob availability backup failed."},{status:502})}

  const select=["id","full_name","club","competition","injured","injury_type","injury_reason","expected_return","injury_updated_at","availability_last_appearance_at","fotmob_id","fotmob_expected_return","fotmob_return_checked_at"].join(",");
  const playersResponse=await fetch(`${supabaseUrl}/rest/v1/players?injured=eq.true&select=${select}&order=draft_rank.asc.nullslast`,{headers:adminHeaders,cache:"no-store"});
  if(!playersResponse.ok)return NextResponse.json({error:"Could not load injured players."},{status:502});
  const flagged=await playersResponse.json() as InjuryPlayer[];
  const players=flagged.filter(isConfirmedInjury);
  let matched=0,dated=0,cached=0,failed=0;
  for(let index=0;index<players.length;index+=4){
    const batch=players.slice(index,index+4);
    const results=await Promise.all(batch.map(async player=>{
      try{return await enrichPlayer(player,supabaseUrl,adminHeaders)}catch{return null}
    }));
    for(const result of results){
      if(!result){failed++;continue}
      if(result.cached)cached++;
      if(result.matched)matched++;
      if(result.dated)dated++;
    }
    if(index+4<players.length)await new Promise(resolve=>setTimeout(resolve,150));
  }
  return NextResponse.json({ok:true,backup,flagged:flagged.length,injuryPlayers:players.length,matched,dated,cached,failed});
}
