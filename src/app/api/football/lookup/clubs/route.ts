import {NextRequest,NextResponse} from 'next/server';
import {providerAction} from '@/lib/sportmonks-route';
import {sportMonksClubLookup} from '@/lib/sportmonks-rosters';
export const dynamic='force-dynamic';
export async function POST(request:NextRequest){
 const body=await request.json().catch(()=>({}));
 const players=body.players as Array<{id:number;label:string}>;
 if(!Array.isArray(players)||players.length<1||players.length>10||players.some(p=>!Number.isSafeInteger(p.id)||p.id<=0||typeof p.label!=='string'))return NextResponse.json({error:'Provide 1–10 valid player IDs and labels.'},{status:400});
 return providerAction(request,async()=>({provider:'sportmonks',requestsUsed:players.length,results:await Promise.all(players.map(async p=>({...await sportMonksClubLookup(p.id),player:p.label})))}));
}
