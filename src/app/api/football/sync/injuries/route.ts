import {NextRequest,NextResponse} from "next/server";
import {apiFootball} from "@/lib/api-football-server";
import {isDeveloperRequest} from "@/lib/developer-auth";
import {fotmobConfirmsActive,recentFotmobClearBlocksInjury} from "@/lib/fotmob-return-update";
import {isApiFootballUnavailable} from "@/lib/player-unavailability";
import {appearanceDisprovesInjury,injuryObservedAt} from "@/lib/injury-observation";

const competitions=[
  {id:39,name:"Premier League"},
  {id:140,name:"La Liga"},
  {id:135,name:"Serie A"},
  {id:78,name:"Bundesliga"},
  {id:61,name:"Ligue 1"},
];

type InjuryEntry={player:{id:number;name:string;type?:string|null;reason?:string|null};team:{id:number;name:string}};
type InjuriesPage={response:InjuryEntry[]};
type SidelinedEntry={type?:string|null;start?:string|null;end?:string|null};
type SidelinedPage={response:SidelinedEntry[]};
type ExistingInjury={api_football_id:number;injured:boolean;injury_type:string|null;injury_reason:string|null;expected_return:string|null;sidelined_checked_at:string|null;fotmob_expected_return:string|null;fotmob_return_checked_at:string|null;injury_updated_at:string|null;availability_last_appearance_at:string|null};

export const maxDuration=300;

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
  const season=2026;
  const unavailable:string[]=[];
  let requestsUsed=0,injuriesSynced=0,sidelinedLookups=0,sidelinedCacheHits=0,playersCleared=0;

  for(const competition of competitions){
    try{
      const injuryBody=await apiFootball<InjuriesPage>(`injuries?league=${competition.id}&season=${season}`);requestsUsed++;
      const existingResponse=await fetch(`${supabaseUrl}/rest/v1/players?competition=eq.${encodeURIComponent(competition.name)}&select=api_football_id,injured,injury_type,injury_reason,expected_return,sidelined_checked_at,fotmob_expected_return,fotmob_return_checked_at,injury_updated_at,availability_last_appearance_at`,{headers:adminHeaders,cache:"no-store"});
      if(!existingResponse.ok)throw new Error((await existingResponse.text())||"Could not load cached injury statuses");
      const existingRows=await existingResponse.json() as ExistingInjury[];
      const existingById=new Map(existingRows.filter(row=>row.api_football_id).map(row=>[row.api_football_id,row]));
      const currentByPlayer=[...new Map(injuryBody.response.filter(entry=>isApiFootballUnavailable(entry.player.type,entry.player.reason)).map(entry=>[entry.player.id,entry])).values()];
      const currentIds=new Set(currentByPlayer.map(entry=>entry.player.id));
      const observedAt=new Date().toISOString();
      playersCleared+=existingRows.filter(row=>row.injured&&!currentIds.has(row.api_football_id)).length;
      const excludedIds=currentIds.size?`&api_football_id=not.in.(${[...currentIds].join(",")})`:"";

      const clearResponse=await fetch(`${supabaseUrl}/rest/v1/players?competition=eq.${encodeURIComponent(competition.name)}&or=(injured.eq.true,injury_type.not.is.null)${excludedIds}`,{
        method:"PATCH",
        headers:{...adminHeaders,Prefer:"return=minimal"},
        body:JSON.stringify({injured:false,injury_type:null,injury_reason:null,expected_return:null,injury_updated_at:observedAt,sidelined_checked_at:null}),
        cache:"no-store",
      });
      if(!clearResponse.ok)throw new Error((await clearResponse.text())||"Could not clear stale injury statuses");

      for(const injury of currentByPlayer){
        const injuryType=injury.player.type??"Injury";
        const injuryReason=injury.player.reason??null;
        const existing=existingById.get(injury.player.id);
        if(fotmobConfirmsActive(existing?.fotmob_expected_return))continue;
        if(existing&&recentFotmobClearBlocksInjury(existing.injured,existing.fotmob_return_checked_at))continue;
        if(appearanceDisprovesInjury(existing,injuryType,injuryReason))continue;
        const refreshSidelined=shouldRefreshSidelined(existing,injuryType,injuryReason);
        let returnDate=existing?.expected_return??null;
        let checkedAt=existing?.sidelined_checked_at??null;

        if(refreshSidelined){
          try{
            const sidelined=await apiFootball<SidelinedPage>(`sidelined?player=${injury.player.id}`);requestsUsed++;sidelinedLookups++;
            returnDate=expectedReturn(sidelined.response);
            checkedAt=new Date().toISOString();
          }catch{
            // Keep the current injury/suspension status even if return-date history is unavailable.
          }
        }else sidelinedCacheHits++;

        const injuryResponse=await fetch(`${supabaseUrl}/rest/v1/players?api_football_id=eq.${injury.player.id}`,{
          method:"PATCH",
          headers:{...adminHeaders,Prefer:"return=minimal"},
          body:JSON.stringify({injured:true,injury_type:injuryType,injury_reason:injuryReason,expected_return:returnDate,injury_updated_at:injuryObservedAt(existing,injuryType,injuryReason,observedAt),sidelined_checked_at:checkedAt}),
          cache:"no-store",
        });
        if(!injuryResponse.ok)throw new Error((await injuryResponse.text())||"Could not save player injury status");
        injuriesSynced++;
      }
    }catch{
      unavailable.push(competition.name);
    }
  }

  if(unavailable.length===competitions.length){
    return NextResponse.json({error:"Injury synchronization failed for every Top Five competition.",season,requestsUsed,unavailable},{status:502});
  }

  return NextResponse.json({ok:true,season,injuriesSynced,playersCleared,sidelinedLookups,sidelinedCacheHits,requestsUsed,unavailable});
}
