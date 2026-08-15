"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function PlayersPage(){
  const router=useRouter();
  useEffect(()=>{void (async()=>{const{data}=await supabase.rpc("my_leagues");const active=(data??[])[0] as {game_format?:string;league_id:string}|undefined;router.replace(active?.game_format==="pack"?`/packs?league=${active.league_id}`:"/waivers")})()},[router]);
  return <main className="app-shell"><section className="panel empty-state">Opening your player area…</section></main>;
}
