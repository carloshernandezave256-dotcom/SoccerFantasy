import {NextRequest,NextResponse} from "next/server";
import {isDeveloperRequest} from "@/lib/developer-auth";
import {parseFotmobMatchDetails,parseFotmobMatches} from "@/lib/fotmob-provider-lab";

export const dynamic="force-dynamic";

async function fotmob(path:string){
  const response=await fetch(`https://www.fotmob.com/api/data/${path}`,{headers:{Accept:"application/json","User-Agent":"Mozilla/5.0 (compatible; MyFantasyXI-ProviderLab/1.0)"},next:{revalidate:300}});
  if(!response.ok)throw new Error(`FotMob returned ${response.status}`);
  return await response.json() as unknown;
}

export async function GET(request:NextRequest){
  if(!await isDeveloperRequest(request))return NextResponse.json({error:"Developer access required."},{status:403});
  const mode=request.nextUrl.searchParams.get("mode")??"matches";
  try{
    if(mode==="matches"){
      const date=request.nextUrl.searchParams.get("date")??new Date().toISOString().slice(0,10).replaceAll("-","");
      if(!/^\d{8}$/.test(date))return NextResponse.json({error:"Date must use YYYYMMDD."},{status:400});
      return NextResponse.json({date,matches:parseFotmobMatches(await fotmob(`matches?date=${date}`)),cacheSeconds:300},{headers:{"Cache-Control":"private, no-store"}});
    }
    if(mode==="match"){
      const matchId=request.nextUrl.searchParams.get("matchId")??"";
      if(!/^\d+$/.test(matchId))return NextResponse.json({error:"A numeric FotMob match ID is required."},{status:400});
      return NextResponse.json({...parseFotmobMatchDetails(await fotmob(`matchDetails?matchId=${matchId}`)),cacheSeconds:300},{headers:{"Cache-Control":"private, no-store"}});
    }
    return NextResponse.json({error:"Unknown provider-lab mode."},{status:400});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"Provider test failed."},{status:502});
  }
}
