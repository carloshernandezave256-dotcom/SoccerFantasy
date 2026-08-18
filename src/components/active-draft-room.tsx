"use client";

import { useEffect, useState } from "react";
import { DraftRoom } from "./draft-room";
import { supabase } from "@/lib/supabase";
import { resolveActiveLeague } from "@/lib/active-league";
import { loginPathFor } from "@/lib/auth-navigation";

export function ActiveDraftRoom({requestedLeagueId}:{requestedLeagueId?:string}){
  const[leagueId,setLeagueId]=useState("");
  useEffect(()=>{void(async()=>{const{data:{user}}=await supabase.auth.getUser();if(!user){window.location.replace(loginPathFor(window.location.pathname,window.location.search));return}const{data}=await supabase.rpc("my_leagues");const active=resolveActiveLeague((data??[]) as {league_id:string}[],requestedLeagueId);setLeagueId(active?.league_id??"")})()},[requestedLeagueId]);
  if(!leagueId)return <main className="app-shell">Loading draft…</main>;
  return <DraftRoom leagueId={leagueId}/>;
}
