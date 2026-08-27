"use client";
import {useEffect,useState} from "react";
import {useRouter} from "next/navigation";
import {PageShell} from "@/components/page-shell";
import {ProviderLab} from "@/components/provider-lab";
import {supabase} from "@/lib/supabase";

export default function ProviderLabPage(){
 const router=useRouter(),[allowed,setAllowed]=useState<boolean|null>(null);
 useEffect(()=>{void(async()=>{const{data:{session}}=await supabase.auth.getSession();if(!session){router.replace("/login?next=/provider-lab");return}const response=await fetch("/api/developer/access",{headers:{Authorization:`Bearer ${session.access_token}`}});setAllowed(response.ok)})()},[router]);
 return <PageShell eyebrow="DATA SOURCE EXPERIMENT" title="Provider Lab">{allowed===null?<section className="panel empty-state">Checking developer access…</section>:allowed?<ProviderLab/>:<section className="panel empty-state"><strong>Developer access only.</strong></section>}</PageShell>
}
