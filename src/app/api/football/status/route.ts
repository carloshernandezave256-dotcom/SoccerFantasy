import {NextRequest} from 'next/server';
import {currentSeasons} from '@/lib/sportmonks-data';
import {providerAction} from '@/lib/sportmonks-route';
export const dynamic='force-dynamic';
export async function GET(request:NextRequest){return providerAction(request,async()=>{
 const result=await currentSeasons();return {connected:true,active:true,provider:'sportmonks',plan:'Top Five',leagues:result.seasons.map(c=>c.name),requestsToday:null,dailyLimit:null};
});}
