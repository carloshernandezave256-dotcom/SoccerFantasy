import {NextRequest,NextResponse} from 'next/server';
import {isDeveloperRequest} from '@/lib/developer-auth';
import {sportmonks} from '@/lib/sportmonks-server';
export const dynamic='force-dynamic';
export const maxDuration=60;
export async function GET(request:NextRequest){
 const cron=Boolean(process.env.CRON_SECRET)&&request.headers.get('authorization')===`Bearer ${process.env.CRON_SECRET}`;
 if(!cron&&!await isDeveloperRequest(request))return NextResponse.json({error:'Developer access required.'},{status:403});
 const mode=request.nextUrl.searchParams.get('mode')??'leagues';
 const page=request.nextUrl.searchParams.get('page')??'1';
 if(!/^[1-9]\d{0,3}$/.test(page))return NextResponse.json({error:'Invalid page.'},{status:400});
 try{
  let result;
  if(mode==='leagues')result=await sportmonks('leagues',{per_page:'50',page});
  else if(mode==='fixtures'){
   const date=request.nextUrl.searchParams.get('date')??new Date().toISOString().slice(0,10);
   if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return NextResponse.json({error:'Use YYYY-MM-DD.'},{status:400});
   result=await sportmonks(`fixtures/date/${date}`,{include:'participants;scores;state;league',per_page:'50',page});
  }else if(mode==='fixture'){
   const id=request.nextUrl.searchParams.get('id')??'';
   if(!/^[1-9]\d{0,10}$/.test(id))return NextResponse.json({error:'A SportMonks fixture ID is required.'},{status:400});
   result=await sportmonks(`fixtures/${id}`,{include:'participants;scores;state;lineups.player;lineups.details.type;events'});
  }else return NextResponse.json({error:'Unknown mode.'},{status:400});
  return NextResponse.json({provider:'sportmonks',connected:true,...result},{headers:{'Cache-Control':'private, no-store'}});
 }catch(error){return NextResponse.json({connected:false,error:error instanceof Error?error.message:'SportMonks connection failed.'},{status:502});}
}
