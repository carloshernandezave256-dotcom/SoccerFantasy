"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function PlayersPage(){
  const router=useRouter();
  useEffect(()=>{void (async()=>{const{data}=await supabase.rpc("my_leagues");const list=(data??[]) as {game_format?:string;league_id:string}[];const requested=new URLSearchParams(window.location.search).get("league");const active=list.find(item=>item.league_id===requested)??list[0];router.replace(active?.game_format==="pack"?`/packs?league=${active.league_id}`:`/waivers?league=${active?.league_id??""}`)})()},[router]);
  return <main className="app-shell"><section className="panel empty-state">Opening your player area…</section></main>;
}
