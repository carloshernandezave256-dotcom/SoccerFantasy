"use client";

import { useEffect, useState } from "react";
import { DraftRoom } from "./draft-room";
import { supabase } from "@/lib/supabase";
import { resolveActiveLeague } from "@/lib/active-league";

export function ActiveDraftRoom({requestedLeagueId}:{requestedLeagueId?:string}){
  const[leagueId,setLeagueId]=useState("");
  useEffect(()=>{void(async()=>{const{data}=await supabase.rpc("my_leagues");const active=resolveActiveLeague((data??[]) as {league_id:string}[],requestedLeagueId);setLeagueId(active?.league_id??"")})()},[requestedLeagueId]);
  if(!leagueId)return <main className="app-shell">Loading draft…</main>;
  return <DraftRoom leagueId={leagueId}/>;
}
