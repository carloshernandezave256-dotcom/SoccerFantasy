"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type PlayerHeadshotProps = {
  name: string;
  position: string;
  photoUrl?: string | null;
  className?: string;
  decorative?: boolean;
};

type Availability={injury_type:string|null;injury_reason:string|null};
let availabilityCache:Map<string,Availability>|null=null;
let availabilityPromise:Promise<Map<string,Availability>>|null=null;

function playerKey(name:string){return name.trim().toLowerCase()}
function isSuspension(status:Availability){const value=`${status.injury_type??""} ${status.injury_reason??""}`.toLowerCase();return value.includes("susp")||value.includes("red card")}
async function loadUnavailablePlayers(){
  if(availabilityCache)return availabilityCache;
  if(availabilityPromise)return availabilityPromise;
  availabilityPromise=(async()=>{
    const{data}=await supabase.from("players").select("full_name,injury_type,injury_reason").eq("injured",true).limit(1000);
    const map=new Map<string,Availability>();
    for(const row of data??[])map.set(playerKey(String(row.full_name)),{injury_type:row.injury_type??null,injury_reason:row.injury_reason??null});
    availabilityCache=map;availabilityPromise=null;return map;
  })();
  return availabilityPromise;
}

export function PlayerHeadshot({ name, position, photoUrl, className = "", decorative = false }: PlayerHeadshotProps) {
  const [failed, setFailed] = useState(false);
  const[availability,setAvailability]=useState<Availability|null>(availabilityCache?.get(playerKey(name))??null);
  const classes = `player-headshot ${className}`.trim();
  useEffect(()=>{let active=true;void loadUnavailablePlayers().then(map=>{if(active)setAvailability(map.get(playerKey(name))??null)});return()=>{active=false}},[name]);
  const suspension=availability?isSuspension(availability):false;
  const badge=availability?<span className={`player-availability-badge ${suspension?"suspension":"injury"}`} title={availability.injury_reason??availability.injury_type??"Unavailable"} aria-label={suspension?"Player suspended":"Player injured"}>{suspension?"":"✚"}</span>:null;

  if (!photoUrl || failed) {
    return <span className={`${classes} player-headshot-fallback position ${position.toLowerCase()}`} aria-label={decorative ? undefined : `${position} player`}>{position}{badge}</span>;
  }

  return <span className={classes}>
    <img src={photoUrl} alt={decorative ? "" : `${name} headshot`} onError={() => setFailed(true)} loading="lazy" referrerPolicy="no-referrer" />
    {badge}
  </span>;
}
