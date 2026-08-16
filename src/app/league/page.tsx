"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { supabase } from "@/lib/supabase";
import { resolveActiveLeague, setActiveLeagueId } from "@/lib/active-league";
import {ApiFootballTest} from "@/components/api-football-test";

type League={league_id:string;league_name:string;invite_code:string;league_size:number;manager_count:number;team_name:string;is_commissioner:boolean;game_format:"draft"|"pack"};
type Manager={draft_slot:number;user_id:string;team_name:string};
type Draft={status:"waiting"|"live"|"paused"|"complete"}|null;
type Settings={league_name:string;joining_open:boolean;draft_pick_seconds:number;trades_enabled:boolean;lineup_lock_minutes:number;motm_manual:boolean;calendar_competition:string;player_pool:string};
type TransactionWindow={gameweek:number;waiver_process_at:string;roster_lock_at:string;phase:string};

function withTimeout<T>(request:PromiseLike<T>,milliseconds=12000):Promise<T>{return Promise.race([Promise.resolve(request),new Promise<T>((_,reject)=>window.setTimeout(()=>reject(new Error("The request timed out. Please try again.")),milliseconds))])}

export default function LeaguePage(){
  const[leagues,setLeagues]=useState<League[]>([]);
  const[activeId,setActiveId]=useState("");
  const[managers,setManagers]=useState<Manager[]>([]);
  const[draft,setDraft]=useState<Draft>(null);
  const[settings,setSettings]=useState<Settings|null>(null);
  const[settingsBusy,setSettingsBusy]=useState(false);
  const[transactionWindow,setTransactionWindow]=useState<TransactionWindow|null>(null);
  const[showMembership,setShowMembership]=useState(false);
  const[tab,setTab]=useState<"create"|"join">("create");
  const[gameFormat,setGameFormat]=useState<"draft"|"pack">("draft");
  const[playerPool,setPlayerPool]=useState("All Top Five");
  const[calendarCompetition,setCalendarCompetition]=useState("Premier League");
  const[code,setCode]=useState("");
  const[message,setMessage]=useState("");
  const[signedIn,setSignedIn]=useState<boolean|null>(null);
  const[busy,setBusy]=useState(false);
  const active=leagues.find(league=>league.league_id===activeId)??leagues[0]??null;

  async function loadDetails(id:string){
    const[orderResult,draftResult,settingsResult,windowResult]=await Promise.all([supabase.rpc("draft_order",{p_league_id:id}),supabase.from("drafts").select("status").eq("league_id",id).maybeSingle(),supabase.rpc("league_settings",{p_league_id:id}),supabase.rpc("transaction_window",{p_league_id:id})]);
    if(orderResult.error)setMessage(orderResult.error.message);else setManagers((orderResult.data??[]) as Manager[]);
    setDraft((draftResult.data as Draft)??null);
    if(settingsResult.error)setMessage(settingsResult.error.message);else setSettings(((settingsResult.data??[])[0] as Settings)??null);
    if(!windowResult.error)setTransactionWindow(((windowResult.data??[])[0] as TransactionWindow)??null);
  }

  async function load(preferred?:string){
    const{data:{user}}=await supabase.auth.getUser();setSignedIn(Boolean(user));if(!user)return;
    const{data,error}=await supabase.rpc("my_leagues");
    if(error){setMessage(error.message);return}
    const list=(data??[]) as League[];setLeagues(list);
    const selected=resolveActiveLeague(list,preferred);const id=selected?.league_id??"";setActiveId(id);
    if(id)await loadDetails(id);else{setManagers([]);setDraft(null)}
  }

  useEffect(()=>{const params=new URLSearchParams(window.location.search),inviteCode=params.get("invite"),requested=params.get("league")??undefined;if(inviteCode){setCode(inviteCode.toUpperCase());setTab("join");setShowMembership(true)}void load(requested)},[]);

  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setMessage("");const formElement=event.currentTarget;
    if(!signedIn){setSignedIn(false);setMessage("Log in first so this league can be saved to your account.");return}
    setBusy(true);const form=new FormData(formElement);const args=tab==="create"?{p_name:String(form.get("league")),p_team_name:String(form.get("team")),p_size:Number(form.get("size")),p_draft_pick_seconds:Number(form.get("draft_pick_seconds")??90),p_trades_enabled:form.get("trades_enabled")==="on",p_lineup_lock_minutes:Number(form.get("lineup_lock_minutes")),p_game_format:gameFormat,p_calendar_competition:playerPool==="All Top Five"?calendarCompetition:playerPool,p_player_pool:playerPool}:{p_invite_code:code.toUpperCase(),p_team_name:String(form.get("team"))};
    try{const{data,error}=await withTimeout(supabase.rpc(tab==="create"?"create_league":"join_league",args));if(error)setMessage(error.message);else{const id=String(data??"");setActiveLeagueId(id);setMessage(tab==="create"?"League created. Your commissioner controls are ready.":"You joined the league.");formElement.reset();setCode("");setShowMembership(false);await load(id)}}catch(error){setMessage(error instanceof Error?error.message:"The request could not be completed.")}finally{setBusy(false)}
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

  async function saveGameweek(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(!active)return;setSettingsBusy(true);setMessage("");const form=new FormData(event.currentTarget),raw=String(form.get("first_kickoff")??"");
    const{error}=await supabase.rpc("set_transaction_window",{p_league_id:active.league_id,p_gameweek:Number(form.get("gameweek")),p_roster_lock_at:new Date(raw).toISOString()});
    if(error)setMessage(error.message);else{setMessage("Gameweek scheduled. Waivers will process Thursday at 8:00 AM Pacific.");await loadDetails(active.league_id)}setSettingsBusy(false)
  }

  async function deleteLeague(){
    if(!active||!active.is_commissioner)return;
    const confirmed=window.confirm(`Permanently delete “${active.league_name}”?\n\nThis removes every manager, roster, draft pick, pack, waiver, trade, score and matchup in this league. This cannot be undone.`);
    if(!confirmed)return;
    setSettingsBusy(true);setMessage("");
    const{error}=await supabase.rpc("delete_league",{p_league_id:active.league_id,p_confirm_name:active.league_name});
    if(error)setMessage(error.message);else{window.localStorage.removeItem("xi-fantasy-active-league");setMessage("League permanently deleted.");setActiveId("");await load()}
    setSettingsBusy(false);
  }

  const joiningLocked=Boolean(draft)||settings?.joining_open===false;
  return <PageShell eyebrow="PRIVATE COMPETITION" title={active&&!showMembership?active.league_name:"Your leagues"}>
    {signedIn===false?<section className="panel empty-state"><strong>Log in to create or join a league.</strong><p>Your leagues and commissioner settings are tied to your account.</p><Link className="primary-button full-button" href="/login?next=/league">Log in to continue</Link></section>:active&&!showMembership?<>
      <section className="panel league-identity"><div className="section-row"><div><p className="eyebrow">{active.is_commissioner?"COMMISSIONER":"LEAGUE MEMBER"}</p><h2>{active.team_name}</h2></div><span className={`league-state ${joiningLocked?"locked":"open"}`}>{joiningLocked?"JOINING LOCKED":"JOINING OPEN"}</span></div><div className="league-code"><span><small>INVITE CODE</small><code>{active.invite_code}</code></span><button onClick={()=>void invite(active)}>＋ Invite</button></div><p>{active.manager_count}/{active.league_size} managers · Draft {draft?.status??"not started"}</p></section>
      <section className="league-command-grid">{active.game_format==="pack"?<Link href={`/packs?league=${active.league_id}`}><span>▣</span><strong>Pack club</strong><small>Collection & auction</small></Link>:<Link href={`/draft?league=${active.league_id}`}><span>◷</span><strong>Draft room</strong><small>{draft?.status??"Waiting"}</small></Link>}<Link href="/team"><span>◎</span><strong>My Team</strong><small>Lineup & captain</small></Link>{active.game_format==="pack"?<Link href={`/packs?league=${active.league_id}#auction`}><span>⌁</span><strong>Auction house</strong><small>League duplicates</small></Link>:<Link href="/waivers#claims"><span>↻</span><strong>Waivers</strong><small>Priority & claims</small></Link>}<Link href="/trades"><span>⇄</span><strong>Trades</strong><small>Offers & history</small></Link></section>
      {settings?<section className="panel league-member-note"><p className="eyebrow">PLAYER POOL · SEASON LOCKED</p><h2>{settings.player_pool}</h2><p>{settings.player_pool==="All Top Five"?`${settings.calendar_competition} defines this league’s scoring windows and bye weeks. Players from all five supported leagues are eligible.`:`Only ${settings.player_pool} players are eligible. Its official matchweeks automatically define the fantasy calendar.`}</p></section>:null}
      {active.is_commissioner?<ApiFootballTest leagueId={active.league_id}/>:null}
      {active.is_commissioner&&settings?<><form className="panel commissioner-settings settings-form" onSubmit={saveSettings}><div className="section-row"><div><p className="eyebrow">LEAGUE RULES</p><h2>Commissioner settings</h2></div><span className="muted-chip">C</span></div><label className="settings-field"><span><strong>League name</strong><small>Shown throughout the competition.</small></span><input name="league_name" defaultValue={settings.league_name} minLength={2} maxLength={60} required/></label><label className="settings-field"><span><strong>Draft clock</strong><small>Time allowed for each selection.</small></span><select name="draft_pick_seconds" defaultValue={settings.draft_pick_seconds} disabled={Boolean(draft)}><option value="30">30 seconds</option><option value="60">60 seconds</option><option value="90">90 seconds</option><option value="120">2 minutes</option></select></label><label className="settings-toggle"><span><strong>Allow new managers</strong><small>{draft?"Automatically locked because the draft started.":"Turn off to close invitations early."}</small></span><input type="checkbox" name="joining_open" defaultChecked={settings.joining_open&&!draft} disabled={Boolean(draft)}/><i/></label><label className="settings-toggle"><span><strong>Enable trades</strong><small>Managers exchange players directly. There is no commissioner veto.</small></span><input type="checkbox" name="trades_enabled" defaultChecked={settings.trades_enabled}/><i/></label><label className="settings-field"><span><strong>Lineup lock</strong><small>Applied relative to each player’s kickoff once match data is connected.</small></span><select name="lineup_lock_minutes" defaultValue={settings.lineup_lock_minutes}><option value="0">At kickoff</option><option value="15">15 min before</option><option value="30">30 min before</option><option value="60">60 min before</option></select></label><div className="settings-readonly"><span><strong>Man of the Match</strong><small>Commissioner entry · +1 point; captain earns an additional +4.</small></span><b>MANUAL</b></div><button className="primary-button full-button" disabled={settingsBusy}>{settingsBusy?"Saving…":"Save settings"}</button></form>{active.game_format==="draft"?<form className="panel commissioner-settings settings-form" onSubmit={saveGameweek}><div className="section-row"><div><p className="eyebrow">BETA SCHEDULE</p><h2>Next transaction window</h2></div><span className="muted-chip">AUTO</span></div><label className="settings-field"><span><strong>Gameweek</strong><small>Waiver priority is randomized for this week.</small></span><input name="gameweek" type="number" min="1" defaultValue={(transactionWindow?.gameweek??0)+1} required/></label><label className="settings-field"><span><strong>First match kickoff</strong><small>Claims process Thursday at 8:00 AM Pacific; free agency then stays open until this time.</small></span><input name="first_kickoff" type="datetime-local" required/></label>{transactionWindow?<div className="settings-readonly"><span><strong>Current GW {transactionWindow.gameweek}</strong><small>{transactionWindow.phase.replace("_"," ")} · locks {new Date(transactionWindow.roster_lock_at).toLocaleString()}</small></span><b>{transactionWindow.phase.toUpperCase()}</b></div>:null}<button className="primary-button full-button" disabled={settingsBusy}>{settingsBusy?"Scheduling…":"Schedule gameweek"}</button></form>:null}</>:<section className="panel league-member-note"><p className="eyebrow">LEAGUE SETTINGS</p><h2>Managed by your commissioner</h2><p>{settings?`${settings.draft_pick_seconds}-second draft clock · Trades ${settings.trades_enabled?"enabled":"disabled"} · Lineups lock ${settings.lineup_lock_minutes?`${settings.lineup_lock_minutes} minutes before kickoff`:"at kickoff"}.`:"You can view league rules, while changes remain commissioner-only."}</p></section>}
      <section className="panel league-manager-list"><div className="section-row"><h2>Managers</h2><span className="muted-chip">{managers.length}</span></div>{managers.map(manager=><article key={manager.user_id}><span>{manager.draft_slot}</span><strong>{manager.team_name}</strong>{manager.draft_slot===1?<small>COMMISH</small>:null}</article>)}</section>
      {active.is_commissioner?<section className="panel"><p className="eyebrow">DANGER ZONE</p><h2>Delete this league</h2><p className="league-member-note">Permanently removes the league and all of its test activity for every manager.</p><button type="button" className="sign-out-button" disabled={settingsBusy} onClick={()=>void deleteLeague()}>{settingsBusy?"Deleting…":"Delete league"}</button></section>:null}
      <button className="secondary-button full-button league-secondary-action" onClick={()=>{setShowMembership(true);setMessage("")}}>Create or join another league</button>
      {message?<p className="form-message">{message}</p>:null}
    </>:<>
      {leagues.length?<button className="text-button league-back" onClick={()=>{setShowMembership(false);setMessage("")}}>← Back to league controls</button>:null}
      <section className="segmented"><button className={tab==="create"?"active":""} onClick={()=>setTab("create")}>Create</button><button className={tab==="join"?"active":""} onClick={()=>setTab("join")}>Join</button></section>
      {tab==="create"?<section className="panel form-card"><div className="form-section-title"><p className="eyebrow">PLAYER POOL</p><strong>Choose who can be owned in this league</strong></div><label>Eligible players<select value={playerPool} onChange={event=>{const value=event.target.value;setPlayerPool(value);if(value!=="All Top Five")setCalendarCompetition(value)}}><option>All Top Five</option><option>Premier League</option><option>La Liga</option><option>Serie A</option><option>Bundesliga</option><option>Ligue 1</option></select></label><p>All Top Five is the signature cross-league experience. Choosing one competition limits the draft, packs, waivers and trades to players from that league.</p><div className="form-section-title"><p className="eyebrow">FANTASY CALENDAR</p><strong>Choose the competition your season follows</strong></div><label>Schedule league<select value={playerPool==="All Top Five"?calendarCompetition:playerPool} disabled={playerPool!=="All Top Five"} onChange={event=>setCalendarCompetition(event.target.value)}><option>Premier League</option><option>La Liga</option><option>Serie A</option><option>Bundesliga</option><option>Ligue 1</option></select></label><p>{playerPool==="All Top Five"?"This competition’s official matchweeks define every fantasy scoring window and bye week.":`Automatically matched to ${playerPool} because this is a single-league player pool.`}</p><p className="form-message"><strong>Warning:</strong> the player pool and calendar lock immediately when the league is created.</p></section>:null}
      <form className="panel form-card create-league-form" onSubmit={submit}>{tab==="create"?<><div className="form-section-title"><p className="eyebrow">IDENTITY</p><strong>Name your competition</strong></div><label>League name<input name="league" placeholder="Central Valley Champions" minLength={2} required/></label><label>Your team name<input name="team" placeholder="Barrio XI" minLength={2} required/></label><label>League capacity<select name="size" defaultValue="10"><option value="8">8 managers</option><option value="10">10 managers</option><option value="12">12 managers</option></select></label><div className="form-section-title"><p className="eyebrow">GAME TYPE</p><strong>Choose how managers build their teams</strong></div><div className="format-choice"><button type="button" className={gameFormat==="draft"?"active":""} onClick={()=>setGameFormat("draft")}><span>⇄</span><strong>Draft League</strong><small>Snake draft · one exclusive copy of each player</small></button><button type="button" className={gameFormat==="pack"?"active":""} onClick={()=>setGameFormat("pack")}><span>▣</span><strong>Pack League</strong><small>Open packs · managers can own the same player</small></button></div><div className="form-section-title"><p className="eyebrow">RULES</p><strong>Set up your league</strong></div>{gameFormat==="draft"?<label>Draft clock<select name="draft_pick_seconds" defaultValue="90"><option value="30">30 seconds per pick</option><option value="60">60 seconds per pick</option><option value="90">90 seconds per pick</option><option value="120">2 minutes per pick</option></select></label>:<input type="hidden" name="draft_pick_seconds" value="90"/>}<label>Lineup lock<select name="lineup_lock_minutes" defaultValue="0"><option value="0">At each player’s kickoff</option><option value="15">15 minutes before kickoff</option><option value="30">30 minutes before kickoff</option><option value="60">60 minutes before kickoff</option></select></label><label className="creation-toggle"><span><strong>Allow trades</strong><small>Managers can exchange equal numbers of players.</small></span><input name="trades_enabled" type="checkbox" defaultChecked/></label><div className="creation-rule-summary"><strong>{gameFormat==="draft"?"Draft League beta rules":"Pack League beta rules"}</strong>{gameFormat==="draft"?<span>3 managers minimum to draft</span>:<><span>22-card starter bundle · 50-card collection limit</span><span>Duplicates, pack tokens and league auction house</span></>}<span>18-player squads · 11 starters · 7 bench</span><span>Manual MOTM: +1, plus +4 when captain</span><span>Season-long standings · No playoffs</span></div></>:<><label>Invite code<input name="code" value={code} onChange={event=>setCode(event.target.value.toUpperCase())} placeholder="XI-A1B2C3" required/></label><label>Your team name<input name="team" placeholder="Barrio XI" minLength={2} required/></label></>}<button className="primary-button" disabled={busy}>{busy?"Saving…":tab==="create"?`Create ${gameFormat==="draft"?"Draft":"Pack"} League`:"Join league"}</button>{message?<p className="form-message">{message}</p>:null}</form>
    </>}
  </PageShell>;
}
