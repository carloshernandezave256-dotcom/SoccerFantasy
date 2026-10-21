import {NextRequest,NextResponse} from 'next/server';
import {isDeveloperRequest} from '@/lib/developer-auth';
export const dynamic='force-dynamic';
export async function GET(request:NextRequest){
 if(!await isDeveloperRequest(request))return NextResponse.json({error:'Developer access required.'},{status:403});
 const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!key)return NextResponse.json({error:'Server database credential is not configured.'},{status:503});
 try{
  const response=await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL??'https://ocabrgbrkqmsnalbfzvx.supabase.co'}/rest/v1/rpc/scoring_automation_health`,{
   method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:'{}',cache:'no-store'});
  if(!response.ok)throw new Error('Could not read scoring automation health.');
  return NextResponse.json(await response.json(),{headers:{'Cache-Control':'private, no-store'}});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:String(error)},{status:502});}
}
