import {NextResponse} from "next/server";
import {apiFootball} from "@/lib/api-football-server";

type StatusResponse={response?:{subscription?:{plan?:string;end?:string;active?:boolean};requests?:{current?:number;limit_day?:number}}};

export const dynamic="force-dynamic";

export async function GET(){
  try{
    const body=await apiFootball<StatusResponse>("status");
    const subscription=body.response?.subscription,requests=body.response?.requests;
    return NextResponse.json({connected:true,plan:subscription?.plan??"unknown",active:subscription?.active??true,expiresAt:subscription?.end??null,requestsToday:requests?.current??null,dailyLimit:requests?.limit_day??null},{headers:{"Cache-Control":"no-store"}});
  }catch(error){
    return NextResponse.json({connected:false,error:error instanceof Error?error.message:"API-Football connection failed"},{status:502,headers:{"Cache-Control":"no-store"}});
  }
}
