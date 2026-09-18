'use client';
import {useEffect,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {hasDoubtfulWarning,type PlayerAvailability} from '@/lib/doubtful-status';
let cache:PlayerAvailability[]=[];let fetchedAt=0;let pending:Promise<PlayerAvailability[]>|null=null;
async function load(){
 if(Date.now()-fetchedAt<30000)return cache;
 if(pending)return pending;
 pending=(async()=>{
  const {data,error}=await supabase.from('players').select('id,full_name,injured,injury_type,injury_reason,doubtful_checked_at,doubtful_until').or(`injured.eq.true,doubtful_until.gt.${new Date().toISOString()}`).limit(1000);
  if(!error){cache=(data??[]) as PlayerAvailability[];fetchedAt=Date.now();}
  return cache;
 })().finally(()=>{pending=null;});
 return pending;
}
export function usePlayerAvailability(id?:number,name?:string){
 const [value,setValue]=useState<PlayerAvailability|null>(null);
 useEffect(()=>{
  let active=true;
  const refresh=()=>{void load().then(rows=>{if(!active)return;const found=rows.filter(p=>id!==undefined?p.id===id:p.full_name.trim().toLowerCase()===name?.trim().toLowerCase());setValue(found.length===1?{...found[0]}:null);});};
  refresh();const timer=window.setInterval(refresh,60000);window.addEventListener('focus',refresh);
  return()=>{active=false;window.clearInterval(timer);window.removeEventListener('focus',refresh);};
 },[id,name]);
 return value;
}
export function DoubtfulBadge({playerId}:{playerId:number}){
 const player=usePlayerAvailability(playerId);
 return hasDoubtfulWarning(player)?<span className="doubtful-badge" title="Doubtful — may miss the next match" aria-label="Doubtful — may miss the next match">? Doubtful</span>:null;
}
export function DoubtfulNotice({playerId}:{playerId:number}){
 const player=usePlayerAvailability(playerId);
 if(!hasDoubtfulWarning(player))return null;
 return <section className="doubtful-notice"><strong>? Doubtful</strong><span>May miss the next match.</span>{player?.doubtful_checked_at?<small>Checked {new Date(player.doubtful_checked_at).toLocaleString()}</small>:null}</section>;
}
