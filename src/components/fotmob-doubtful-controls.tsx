'use client';
import {useState} from 'react';
import {supabase} from '@/lib/supabase';
import {doubtfulLeagues,type DoubtfulReport} from '@/lib/fotmob-doubtful';

export function FotmobDoubtfulControls(){
 const [busy,setBusy]=useState(false),[progress,setProgress]=useState(''),[reports,setReports]=useState<DoubtfulReport[]>([]),[errors,setErrors]=useState<string[]>([]);
 async function refresh(){
  setBusy(true);setErrors([]);setReports([]);
  try{
   const {data:{session}}=await supabase.auth.getSession();
   if(!session)throw new Error('Sign in again to check doubtful players.');
   for(const league of doubtfulLeagues){
    setProgress(`Checking ${league.name}…`);
    try{
     const response=await fetch('/api/football/fotmob-doubtful',{method:'POST',headers:{Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({leagueId:league.id})});
     const body=await response.json();if(!response.ok)throw new Error(body.error??'Check failed.');
     setReports(previous=>[...previous,body as DoubtfulReport]);
     if(body.unresolved)setErrors(previous=>[...previous,`${league.name}: ${body.unresolved} player identities need review.`]);
    }catch(error){setErrors(previous=>[...previous,`${league.name}: ${error instanceof Error?error.message:'Check failed.'}`]);}
   }
  }catch(error){setErrors([error instanceof Error?error.message:'Check failed.']);}
  finally{setBusy(false);setProgress('');}
 }
 const players=reports.flatMap(r=>r.players),failures=[...errors,...reports.flatMap(r=>r.errors)],checked=reports.reduce((sum,r)=>sum+r.clubsChecked,0);
 return <section className="panel settings-form">
  <div className="section-row"><div><p className="eyebrow">FOTMOB · SECONDARY CHECK</p><h2>Doubtful players</h2></div><span className="muted-chip">WARNINGS</span></div>
  <p>Refresh doubtful warnings across all five leagues. Warnings expire after 48 hours unless refreshed. Injury records stay separate.</p>
  <button className="secondary-button full-button" type="button" disabled={busy} onClick={()=>void refresh()}>{busy?progress:'Refresh doubtful warnings'}</button>
  <p className="settings-note">A full check can take a few minutes. Missing clubs are reported separately.</p>
  <div role="status" aria-live="polite">{reports.length?`${players.length} doubtful · ${checked}/96 clubs checked${busy?' · still checking':failures.length?' · incomplete results':''}`:null}</div>
  {failures.length?<div role="alert"><strong>Some clubs could not be checked.</strong><ul>{failures.map((error,index)=><li key={index}>{error}</li>)}</ul></div>:null}
  {reports.map(report=><details key={report.league} open><summary><strong>{report.league} · {report.players.length}</strong></summary><p className="settings-note">Checked {new Date(report.checkedAt).toLocaleString()} · {report.clubsChecked}/{report.clubsExpected} clubs</p>{report.players.length?<ul style={{listStyle:'none',padding:0}}>{report.players.map(player=><li key={player.id} style={{padding:'12px 0',borderTop:'1px solid var(--line)'}}><div className="section-row"><strong>{player.name}</strong><span style={{color:'#fbbf24',background:'#78350f55',border:'1px solid #b45309',borderRadius:999,padding:'4px 8px',fontSize:12,whiteSpace:'nowrap'}}>Doubtful</span></div><small>{player.club}</small></li>)}</ul>:<p>{report.errors.length?'No doubtful players found in the clubs checked.':'No players listed as doubtful.'}</p>}</details>)}
 </section>;
}
