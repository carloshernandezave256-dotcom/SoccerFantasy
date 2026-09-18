import {NextRequest,NextResponse} from 'next/server';
import {isDeveloperRequest} from './developer-auth';
export async function providerAuthorized(request:NextRequest){
 return (Boolean(process.env.CRON_SECRET)&&request.headers.get('authorization')===`Bearer ${process.env.CRON_SECRET}`)||await isDeveloperRequest(request);
}
export async function providerAction(request:NextRequest,action:()=>Promise<unknown>,cronOnly=false){
 const cron=Boolean(process.env.CRON_SECRET)&&request.headers.get('authorization')===`Bearer ${process.env.CRON_SECRET}`;
 if(cronOnly?!cron:!await providerAuthorized(request))return NextResponse.json({error:'Developer access required.'},{status:403});
 try{return NextResponse.json(await action(),{headers:{'Cache-Control':'private, no-store'}});}
 catch(error){return NextResponse.json({error:error instanceof Error?error.message:'SportMonks synchronization failed.'},{status:502});}
}
