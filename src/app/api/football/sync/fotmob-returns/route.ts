import {NextRequest,NextResponse} from "next/server";
import {isDeveloperRequest} from "@/lib/developer-auth";

type InjuryPlayer={
  id:number;
  full_name:string;
  club:string;
  injury_type:string|null;
  injury_reason:string|null;
  fotmob_id:number|null;
  fotmob_expected_return:string|null;
  fotmob_return_checked_at:string|null;
};

type SearchCandidate={id:number;name:string;raw:unknown};

export const maxDuration=300;

function normalize(value:string){
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]/g,"");
}

function isConfirmedInjury(player:InjuryPlayer){
  const value=`${player.injury_type??""} ${player.injury_reason??""}`.toLowerCase();
  if(/suspend|red card|yellow card|coach|inactive|rest|transfer|loan agreement|match fitness/.test(value))return false;
  return /injur|illness|health|hernia|strain|sprain|fracture|broken|achilles|hamstring|thigh|groin|knee|ankle|foot|calf|muscle|shoulder|back|hip|rib|arm|finger|wrist|leg/.test(value);
}

function freshEnough(value:string|null){
  if(!value)return false;
  const checked=new Date(value).getTime();
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

async function findFotmobId(player:InjuryPlayer){
  const query=encodeURIComponent(player.full_name);
  let payload:unknown;
  try{payload=await fotmobJson(`search/suggest?hits=12&lang=en&term=${query}`)}
  catch{payload=await fotmobJson(`searchData?term=${query}`)}
  const candidates=searchCandidates(payload);
  if(!candidates.length)return null;
  const wanted=normalize(player.full_name),club=normalize(player.club);
  return candidates.map(candidate=>{
    const candidateName=normalize(candidate.name);
    const raw=normalize(JSON.stringify(candidate.raw));
    let score=0;
    if(candidateName===wanted)score+=100;
    else if(candidateName.includes(wanted)||wanted.includes(candidateName))score+=60;
    if(club&&raw.includes(club))score+=35;
    return {...candidate,score};
  }).sort((a,b)=>b.score-a.score)[0]?.id??null;
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
  if(freshEnough(player.fotmob_return_checked_at))return {cached:true,matched:Boolean(player.fotmob_id),dated:Boolean(player.fotmob_expected_return)};
  let fotmobId=player.fotmob_id;
  if(!fotmobId)fotmobId=await findFotmobId(player);
  let returnLabel:string|null=null;
  if(fotmobId){
    try{returnLabel=expectedReturnFromPayload(await fotmobJson(`playerData?id=${fotmobId}&includeMarketValues=false`))}
    catch{returnLabel=null}
  }
  const response=await fetch(`${supabaseUrl}/rest/v1/players?id=eq.${player.id}`,{
    method:"PATCH",
    headers:{...adminHeaders,Prefer:"return=minimal"},
    body:JSON.stringify({fotmob_id:fotmobId,fotmob_expected_return:returnLabel,fotmob_return_checked_at:new Date().toISOString()}),
    cache:"no-store",
  });
  if(!response.ok)throw new Error((await response.text())||"Could not save FotMob return date");
  return {cached:false,matched:Boolean(fotmobId),dated:Boolean(returnLabel)};
}

export async function POST(request:NextRequest){
  const authorization=request.headers.get("authorization")??"";
  if(!authorization.startsWith("Bearer "))return NextResponse.json({error:"Sign in is required."},{status:401});
  if(!await isDeveloperRequest(request))return NextResponse.json({error:"Developer access required."},{status:403});
  const supabaseUrl=process.env.NEXT_PUBLIC_SUPABASE_URL??"https://ocabrgbrkqmsnalbfzvx.supabase.co";
  const serviceRoleKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!serviceRoleKey)return NextResponse.json({error:"Server database credential is not configured."},{status:503});
  const adminHeaders={apikey:serviceRoleKey,Authorization:`Bearer ${serviceRoleKey}`,"Content-Type":"application/json"};
  const playersResponse=await fetch(`${supabaseUrl}/rest/v1/players?injured=eq.true&select=id,full_name,club,injury_type,injury_reason,fotmob_id,fotmob_expected_return,fotmob_return_checked_at&order=draft_rank.asc.nullslast`,{headers:adminHeaders,cache:"no-store"});
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
  return NextResponse.json({ok:true,flagged:flagged.length,injuryPlayers:players.length,matched,dated,cached,failed});
}
