import {NextRequest,NextResponse} from 'next/server';
import {providerAction} from '@/lib/sportmonks-route';
import {allPages,competitions,fixtureInclude,type SMFixture} from '@/lib/sportmonks-data';
import {sportmonks} from '@/lib/sportmonks-server';
import {previewMatch,previewDetails} from '@/lib/sportmonks-preview';
export const dynamic='force-dynamic';
export async function GET(request:NextRequest){
 const mode=request.nextUrl.searchParams.get('mode')??'matches';
 if(mode==='matches'){
  const date=request.nextUrl.searchParams.get('date')??new Date().toISOString().slice(0,10).replaceAll('-','');
  if(!/^\d{8}$/.test(date))return NextResponse.json({error:'Use YYYYMMDD.'},{status:400});
  return providerAction(request,async()=>{const result=await allPages<SMFixture>(`fixtures/date/${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`,{include:'participants;scores;state'});return {date,provider:'sportmonks',matches:result.rows.filter(f=>competitions.some(c=>c.id===f.league_id)).map(previewMatch),cacheSeconds:0};});
 }
 const id=request.nextUrl.searchParams.get('matchId')??'';
 if(mode!=='match'||!/^[1-9]\d{0,10}$/.test(id))return NextResponse.json({error:'A SportMonks match ID is required.'},{status:400});
 return providerAction(request,async()=>previewDetails((await sportmonks(`fixtures/${id}`,{include:fixtureInclude})).data));
}
