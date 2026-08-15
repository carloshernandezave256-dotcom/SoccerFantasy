"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { supabase } from "@/lib/supabase";

type League={league_id:string;league_name:string;invite_code:string;league_size:number;manager_count:number;team_name:string;is_commissioner:boolean};
type Manager={draft_slot:number;user_id:string;team_name:string};
type Draft={status:"waiting"|"live"|"paused"|"complete"}|null;
type Settings={league_name:string;joining_open:boolean;draft_pick_seconds:number;trades_enabled:boolean;lineup_lock_minutes:number;motm_manual:boolean};

function withTimeout<T>(request:PromiseLike<T>,milliseconds=12000):Promise<T>{return Promise.race([Promise.resolve(request),new Promise<T>((_,reject)=>window.setTimeout(()=>reject(new Error("The request timed out. Please try again.")),milliseconds))])}

export default function LeaguePage(){
  const[leagues,setLeagues]=useState<League[]>([]);
  const[activeId,setActiveId]=useState("");
  const[managers,setManagers]=useState<Manager[]>([]);
  const[draft,setDraft]=useState<Draft>(null);
  const[settings,setSettings]=useState<Settings|null>(null);
  const[settingsBusy,setSettingsBusy]=useState(false);
  const[showMembership,setShowMembership]=useState(false);
  const[tab,setTab]=useState<"create"|"join">("create");
  const[code,setCode]=useState("");
  const[message,setMessage]=useState("");
  const[signedIn,setSignedIn]=useState<boolean|null>(null);
  const[busy,setBusy]=useState(false);
  const active=leagues.find(league=>league.league_id===activeId)??leagues[0]??null;

  async function loadDetails(id:string){
    const[orderResult,draftResult,settingsResult]=await Promise.all([supabase.rpc("draft_order",{p_league_id:id}),supabase.from("drafts").select("status").eq("league_id",id).maybeSingle(),supabase.rpc("league_settings",{p_league_id:id})]);
    if(orderResult.error)setMessage(orderResult.error.message);else setManagers((orderResult.data??[]) as Manager[]);
    setDraft((draftResult.data as Draft)??null);
    if(settingsResult.error)setMessage(settingsResult.error.message);else setSettings(((settingsResult.data??[])[0] as Settings)??null);
  }

  async function load(preferred?:string){
    const{data:{user}}=await supabase.auth.getUser();setSignedIn(Boolean(user));if(!user)return;
    const{data,error}=await supabase.rpc("my_leagues");
    if(error){setMessage(error.message);return}
    const list=(data??[]) as League[];setLeagues(list);
    const id=list.some(item=>item.league_id===preferred)?preferred!:list[0]?.league_id??"";setActiveId(id);
    if(id)await loadDetails(id);else{setManagers([]);setDraft(null)}
  }

  useEffect(()=>{const inviteCode=new URLSearchParams(window.location.search).get("invite");if(inviteCode){setCode(inviteCode.toUpperCase());setTab("join");setShowMembership(true)}void load()},[]);

  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setMessage("");const formElement=event.currentTarget;
    if(!signedIn){setSignedIn(false);setMessage("Log in first so this league can be saved to your account.");return}
    setBusy(true);const form=new FormData(formElement);const args=tab==="create"?{p_name:String(form.get("league")),p_team_name:String(form.get("team")),p_size:Number(form.get("size")),p_draft_pick_seconds:Number(form.get("draft_pick_seconds")),p_trades_enabled:form.get("trades_enabled")==="on",p_lineup_lock_minutes:Number(form.get("lineup_lock_minutes"))}:{p_invite_code:code.toUpperCase(),p_team_name:String(form.get("team"))};
    try{const{data,error}=await withTimeout(supabase.rpc(tab==="create"?"create_league":"join_league",args));if(error)setMessage(error.message);else{setMessage(tab==="create"?"League created. Your commissioner controls are ready.":"You joined the league.");formElement.reset();setCode("");setShowMembership(false);await load(String(data??""))}}catch(error){setMessage(error instanceof Error?error.message:"The request could not be completed.")}finally{setBusy(false)}
  }

  async function invite(league:League){
    const url=`${window.location.origin}/login?invite=${league.invite_code}`;const share={title:`Join ${league.league_name}`,text:`Join my ${league.league_name} fantasy soccer league with code ${league.invite_code}`,url};
    if(navigator.share){try{await navigator.share(share);return}catch{}}
    await navigator.clipboard.writeText(url);setMessage(`Invite link copied for ${league.league_name}.`);
  }

  async function saveSettings(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(!active||!settings)return;setSettingsBusy(true);setMessage("");
    const form=new FormData(event.currentTarget);
    const args={p_league_id:active.league_id,p_name:String(form.get("league_name")),p_joining_open:form.get("joining_open")==="on",p_draft_pick_seconds:Number(form.get("draft_pick_seconds")??settings.draft_pick_seconds),p_trades_enabled:form.get("trades_enabled")==="on",p_lineup_lock_minutes:Number(form.get("lineup_lock_minutes"))};
    const{error}=await supabase.rpc("update_league_settings",args);
    if(error)setMessage(error.message);else{setMessage("League settings saved.");await load(active.league_id)}
    setSettingsBusy(false);
  }

  const joiningLocked=Boolean(draft)||settings?.joining_open===false;
  return <PageShell eyebrow="PRIVATE COMPETITION" title={active&&!showMembership?active.league_name:"Your leagues"}>
    {signedIn===false?<section className="panel empty-state"><strong>Log in to create or join a league.</strong><p>Your leagues and commissioner settings are tied to your account.</p><Link className="primary-button full-button" href="/login?next=/league">Log in to continue</Link></section>:active&&!showMembership?<>
      {leagues.length>1?<label className="league-hub-select">League<select value={active.league_id} onChange={event=>{setActiveId(event.target.value);setMessage("");void loadDetails(event.target.value)}}>{leagues.map(league=><option key={league.league_id} value={league.league_id}>{league.league_name} · {league.team_name}</option>)}</select></label>:null}
      <section className="panel league-identity"><div className="section-row"><div><p className="eyebrow">{active.is_commissioner?"COMMISSIONER":"LEAGUE MEMBER"}</p><h2>{active.team_name}</h2></div><span className={`league-state ${joiningLocked?"locked":"open"}`}>{joiningLocked?"JOINING LOCKED":"JOINING OPEN"}</span></div><div className="league-code"><span><small>INVITE CODE</small><code>{active.invite_code}</code></span><button onClick={()=>void invite(active)}>＋ Invite</button></div><p>{active.manager_count}/{active.league_size} managers · Draft {draft?.status??"not started"}</p></section>
      <section className="league-command-grid"><Link href={`/draft?league=${active.league_id}`}><span>◷</span><strong>Draft room</strong><small>{draft?.status??"Waiting"}</small></Link><Link href="/team"><span>◎</span><strong>My Team</strong><small>Lineup & captain</small></Link><Link href="/waivers#claims"><span>↻</span><strong>Waivers</strong><small>Priority & claims</small></Link><Link href="/trades"><span>⇄</span><strong>Trades</strong><small>Offers & history</small></Link></section>
      {active.is_commissioner&&settings?<form className="panel commissioner-settings settings-form" onSubmit={saveSettings}><div className="section-row"><div><p className="eyebrow">LEAGUE RULES</p><h2>Commissioner settings</h2></div><span className="muted-chip">C</span></div><label className="settings-field"><span><strong>League name</strong><small>Shown throughout the competition.</small></span><input name="league_name" defaultValue={settings.league_name} minLength={2} maxLength={60} required/></label><label className="settings-field"><span><strong>Draft clock</strong><small>Time allowed for each selection.</small></span><select name="draft_pick_seconds" defaultValue={settings.draft_pick_seconds} disabled={Boolean(draft)}><option value="30">30 seconds</option><option value="60">60 seconds</option><option value="90">90 seconds</option><option value="120">2 minutes</option></select></label><label className="settings-toggle"><span><strong>Allow new managers</strong><small>{draft?"Automatically locked because the draft started.":"Turn off to close invitations early."}</small></span><input type="checkbox" name="joining_open" defaultChecked={settings.joining_open&&!draft} disabled={Boolean(draft)}/><i/></label><label className="settings-toggle"><span><strong>Enable trades</strong><small>Managers can send and accept trade offers.</small></span><input type="checkbox" name="trades_enabled" defaultChecked={settings.trades_enabled}/><i/></label><label className="settings-field"><span><strong>Lineup lock</strong><small>Applied relative to each player’s kickoff once match data is connected.</small></span><select name="lineup_lock_minutes" defaultValue={settings.lineup_lock_minutes}><option value="0">At kickoff</option><option value="15">15 min before</option><option value="30">30 min before</option><option value="60">60 min before</option></select></label><div className="settings-readonly"><span><strong>Man of the Match</strong><small>Commissioner entry · +1 point; captain earns an additional +4.</small></span><b>MANUAL</b></div><button className="primary-button full-button" disabled={settingsBusy}>{settingsBusy?"Saving…":"Save settings"}</button></form>:<section className="panel league-member-note"><p className="eyebrow">LEAGUE SETTINGS</p><h2>Managed by your commissioner</h2><p>{settings?`${settings.draft_pick_seconds}-second draft clock · Trades ${settings.trades_enabled?"enabled":"disabled"} · Lineups lock ${settings.lineup_lock_minutes?`${settings.lineup_lock_minutes} minutes before kickoff`:"at kickoff"}.`:"You can view league rules, while changes remain commissioner-only."}</p></section>}
      <section className="panel league-manager-list"><div className="section-row"><h2>Managers</h2><span className="muted-chip">{managers.length}</span></div>{managers.map(manager=><article key={manager.user_id}><span>{manager.draft_slot}</span><strong>{manager.team_name}</strong>{manager.draft_slot===1?<small>COMMISH</small>:null}</article>)}</section>
      <button className="secondary-button full-button league-secondary-action" onClick={()=>{setShowMembership(true);setMessage("")}}>Create or join another league</button>
      {message?<p className="form-message">{message}</p>:null}
    </>:<>
      {leagues.length?<button className="text-button league-back" onClick={()=>{setShowMembership(false);setMessage("")}}>← Back to league controls</button>:null}
      <section className="segmented"><button className={tab==="create"?"active":""} onClick={()=>setTab("create")}>Create</button><button className={tab==="join"?"active":""} onClick={()=>setTab("join")}>Join</button></section>
      <form className="panel form-card create-league-form" onSubmit={submit}>{tab==="create"?<><div className="form-section-title"><p className="eyebrow">IDENTITY</p><strong>Name your competition</strong></div><label>League name<input name="league" placeholder="Central Valley Champions" minLength={2} required/></label><label>Your team name<input name="team" placeholder="Barrio XI" minLength={2} required/></label><label>League capacity<select name="size" defaultValue="10"><option value="8">8 managers</option><option value="10">10 managers</option><option value="12">12 managers</option></select></label><div className="form-section-title"><p className="eyebrow">RULES</p><strong>Set up your league</strong></div><label>Draft clock<select name="draft_pick_seconds" defaultValue="90"><option value="30">30 seconds per pick</option><option value="60">60 seconds per pick</option><option value="90">90 seconds per pick</option><option value="120">2 minutes per pick</option></select></label><label>Lineup lock<select name="lineup_lock_minutes" defaultValue="0"><option value="0">At each player’s kickoff</option><option value="15">15 minutes before kickoff</option><option value="30">30 minutes before kickoff</option><option value="60">60 minutes before kickoff</option></select></label><label className="creation-toggle"><span><strong>Allow trades</strong><small>Managers can exchange equal numbers of players.</small></span><input name="trades_enabled" type="checkbox" defaultChecked/></label><div className="creation-rule-summary"><strong>Fixed beta rules</strong><span>3 managers minimum to draft</span><span>18-player rosters · 11 starters · 7 bench</span><span>Manual MOTM: +1, plus +4 when captain</span><span>Season-long standings · No playoffs</span></div></>:<><label>Invite code<input name="code" value={code} onChange={event=>setCode(event.target.value.toUpperCase())} placeholder="XI-A1B2C3" required/></label><label>Your team name<input name="team" placeholder="Barrio XI" minLength={2} required/></label></>}<button className="primary-button" disabled={busy}>{busy?"Saving…":tab==="create"?"Create league with these rules":"Join league"}</button>{message?<p className="form-message">{message}</p>:null}</form>
    </>}
  </PageShell>;
}
