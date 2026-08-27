import {NextRequest,NextResponse} from "next/server";
import {apiFootball} from "@/lib/api-football-server";
import {isDeveloperRequest} from "@/lib/developer-auth";

type LookupPlayer={id:number;label:string};
type SquadResponse={response?:Array<{team?:{id?:number;name?:string;logo?:string};players?:Array<{id?:number;name?:string}>}>};

const MAX_PLAYERS=10;

export const dynamic="force-dynamic";

export async function POST(request:NextRequest){
  if(!await isDeveloperRequest(request))return NextResponse.json({error:"Developer access required."},{status:403});

  const body=await request.json().catch(()=>null) as {players?:LookupPlayer[]}|null;
  const players=body?.players;
  if(!Array.isArray(players)||players.length<1||players.length>MAX_PLAYERS||players.some(player=>!Number.isSafeInteger(player?.id)||player.id<=0||typeof player.label!=="string"||!player.label.trim())){
    return NextResponse.json({error:`Provide between 1 and ${MAX_PLAYERS} players with a positive API-Football ID and label.`},{status:400});
  }

  try{
    const results=[];
    for(const player of players){
      const provider=await apiFootball<SquadResponse>(`players/squads?player=${player.id}`);
      const squad=provider.response?.[0];
      results.push({
        playerId:player.id,
        player:player.label.trim(),
        providerPlayer:squad?.players?.find(candidate=>candidate.id===player.id)?.name??squad?.players?.[0]?.name??null,
        clubId:squad?.team?.id??null,
        club:squad?.team?.name??null,
        clubLogo:squad?.team?.logo??null,
      });
    }

    console.info("[developer-club-lookup]",JSON.stringify({requestsUsed:players.length,results:results.map(({playerId,player,clubId,club})=>({playerId,player,clubId,club}))}));
    return NextResponse.json({requestsUsed:players.length,results},{headers:{"Cache-Control":"no-store"}});
  }catch(error){
    console.error("[developer-club-lookup] failed",error);
    return NextResponse.json({error:error instanceof Error?error.message:"API-Football club lookup failed."},{status:502,headers:{"Cache-Control":"no-store"}});
  }
}
