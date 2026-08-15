"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageShell } from "./page-shell";
import { supabase } from "@/lib/supabase";

type League={league_id:string;league_name:string;team_name:string};
type Manager={draft_slot:number;user_id:string;team_name:string};
type Player={id:number;full_name:string;position:string;club:string};
type Pick={user_id:string;players:Player|null};
type TradePlayer={player_id:number;from_user_id:string;players:Player|null};
type Trade={id:string;league_id:string;proposer_id:string;recipient_id:string;status:"pending"|"accepted"|"declined"|"cancelled";note:string|null;created_at:string;responded_at:string|null;trade_players:TradePlayer[]};

export function TradeCenter(){
  const[leagues,setLeagues]=useState<League[]>([]);
  const[league,setLeague]=useState("");
  const[managers,setManagers]=useState<Manager[]>([]);
  const[userId,setUserId]=useState("");
  const[partner,setPartner]=useState("");
  const[picks,setPicks]=useState<Pick[]>([]);
  const[trades,setTrades]=useState<Trade[]>([]);
  const[offered,setOffered]=useState<number[]>([]);
  const[requested,setRequested]=useState<number[]>([]);
  const[note,setNote]=useState("");
  const[tab,setTab]=useState<"build"|"offers">("build");
  const[message,setMessage]=useState("");
  const[loading,setLoading]=useState(true);
  const[busy,setBusy]=useState(false);

  const loadLeague=useCallback(async(id:string,currentUser:string)=>{
    setLoading(true);
    const[orderResult,pickResult,tradeResult]=await Promise.all([
      supabase.rpc("draft_order",{p_league_id:id}),
      supabase.from("draft_picks").select("user_id,players(id,full_name,position,club)").eq("league_id",id),
      supabase.from("trades").select("id,league_id,proposer_id,recipient_id,status,note,created_at,responded_at,trade_players(player_id,from_user_id,players(id,full_name,position,club))").eq("league_id",id).order("created_at",{ascending:false}),
    ]);
    const error=orderResult.error??pickResult.error??tradeResult.error;
    if(error)setMessage(error.message);
    const managerList=(orderResult.data??[]) as Manager[];
    setManagers(managerList);
    setPartner(old=>managerList.some(manager=>manager.user_id===old&&old!==currentUser)?old:managerList.find(manager=>manager.user_id!==currentUser)?.user_id??"");
    setPicks((pickResult.data??[]) as unknown as Pick[]);
    setTrades((tradeResult.data??[]) as unknown as Trade[]);
    setOffered([]);setRequested([]);setLoading(false);
  },[]);

  useEffect(()=>{void(async()=>{
    const{data:{user}}=await supabase.auth.getUser();
    if(!user){setLoading(false);return}
    setUserId(user.id);
    const{data,error}=await supabase.rpc("my_leagues");
    if(error){setMessage(error.message);setLoading(false);return}
    const list=(data??[]) as League[];setLeagues(list);
    if(list[0]){setLeague(list[0].league_id);await loadLeague(list[0].league_id,user.id)}else setLoading(false);
  })()},[loadLeague]);

  const myRoster=useMemo(()=>picks.filter(pick=>pick.user_id===userId&&pick.players).map(pick=>pick.players as Player),[picks,userId]);
  const partnerRoster=useMemo(()=>picks.filter(pick=>pick.user_id===partner&&pick.players).map(pick=>pick.players as Player),[picks,partner]);
  const managerMap=useMemo(()=>new Map(managers.map(manager=>[manager.user_id,manager.team_name])),[managers]);
  const selectedOffered=useMemo(()=>myRoster.filter(player=>offered.includes(player.id)),[myRoster,offered]);
  const selectedRequested=useMemo(()=>partnerRoster.filter(player=>requested.includes(player.id)),[partnerRoster,requested]);
  const pendingCount=trades.filter(trade=>trade.status==="pending"&&(trade.proposer_id===userId||trade.recipient_id===userId)).length;
  const canPropose=offered.length>0&&offered.length===requested.length&&!busy;

  function toggle(id:number,side:"offer"|"request"){
    const setter=side==="offer"?setOffered:setRequested;
    setter(current=>current.includes(id)?current.filter(playerId=>playerId!==id):[...current,id]);
  }

  async function propose(){
    if(!league||!partner||!canPropose)return;
    setBusy(true);setMessage("");
    const{error}=await supabase.rpc("create_trade_offer",{p_league_id:league,p_recipient_id:partner,p_offered:offered,p_requested:requested,p_note:note});
    if(error)setMessage(error.message);else{setMessage(`Trade offer sent to ${managerMap.get(partner)}.`);setNote("");setTab("offers");await loadLeague(league,userId)}
    setBusy(false);
  }

  async function respond(id:string,accept:boolean){
    setBusy(true);setMessage("");
    const{error}=await supabase.rpc("respond_to_trade",{p_trade_id:id,p_accept:accept});
    if(error)setMessage(error.message);else{setMessage(accept?"Trade accepted. Both rosters were updated.":"Trade declined.");await loadLeague(league,userId)}
    setBusy(false);
  }

  async function cancel(id:string){
    setBusy(true);setMessage("");
    const{error}=await supabase.rpc("cancel_trade",{p_trade_id:id});
    if(error)setMessage(error.message);else{setMessage("Trade offer cancelled.");await loadLeague(league,userId)}
    setBusy(false);
  }

  return <PageShell eyebrow="LEAGUE TRANSACTIONS" title="Trade Center">
    {!userId&&!loading?<section className="panel empty-feature"><span>⇄</span><h2>Sign in to trade</h2><p>Trade offers are available to managers inside the same league.</p><Link className="primary-button" href="/login?next=/trades">Log in</Link></section>:leagues.length===0&&!loading?<section className="panel empty-feature"><span>＋</span><h2>Join a league first</h2><p>Your real roster and league opponents will appear here after you draft.</p><Link className="primary-button" href="/league">Open leagues</Link></section>:<>
      <div className="trade-selectors"><label>League<select value={league} onChange={event=>{const id=event.target.value;setLeague(id);void loadLeague(id,userId)}}>{leagues.map(item=><option key={item.league_id} value={item.league_id}>{item.league_name}</option>)}</select></label>{tab==="build"?<label>Trade with<select value={partner} onChange={event=>{setPartner(event.target.value);setRequested([])}}>{managers.filter(manager=>manager.user_id!==userId).map(manager=><option key={manager.user_id} value={manager.user_id}>{manager.team_name}</option>)}</select></label>:null}</div>
      <nav className="trade-tabs"><button className={tab==="build"?"active":""} onClick={()=>setTab("build")}>Build trade</button><button className={tab==="offers"?"active":""} onClick={()=>setTab("offers")}>Offers {pendingCount?<span>{pendingCount}</span>:null}</button></nav>
      {message?<p className="panel trade-message">{message}</p>:null}
      {tab==="build"?<>{loading?<section className="panel empty-state">Loading league rosters…</section>:partner?<><section className="trade-summary"><div><small>YOU SEND</small><strong>{offered.length}</strong></div><span>⇄</span><div><small>YOU RECEIVE</small><strong>{requested.length}</strong></div></section><p className="trade-balance-note">Select the same number of players on each side.</p><section className="trade-grid"><TradeRoster title={leagues.find(item=>item.league_id===league)?.team_name??"Your team"} instruction="Select players to offer" roster={myRoster} selected={offered} onToggle={id=>toggle(id,"offer")}/><TradeRoster title={managerMap.get(partner)??"Other team"} instruction="Select players to request" roster={partnerRoster} selected={requested} onToggle={id=>toggle(id,"request")}/></section><section className="panel trade-compose"><div><small>OFFER</small><strong>{selectedOffered.map(player=>player.full_name).join(", ")||"No players selected"}</strong></div><span>for</span><div><small>REQUEST</small><strong>{selectedRequested.map(player=>player.full_name).join(", ")||"No players selected"}</strong></div><label>Message (optional)<textarea maxLength={280} value={note} onChange={event=>setNote(event.target.value)} placeholder="Add a note to the other manager"/></label></section><button className="primary-button full-button" onClick={()=>void propose()} disabled={!canPropose}>{busy?"Sending…":"Send trade offer"}</button></>:<section className="panel empty-state">Another manager must join this league before you can trade.</section>}</>:<TradeOffers trades={trades.filter(trade=>trade.proposer_id===userId||trade.recipient_id===userId)} userId={userId} managerMap={managerMap} busy={busy} onRespond={respond} onCancel={cancel}/>} 
    </>}
  </PageShell>;
}

function TradeRoster({title,instruction,roster,selected,onToggle}:{title:string;instruction:string;roster:Player[];selected:number[];onToggle:(id:number)=>void}){
  return <section className="panel trade-roster"><div className="section-row"><div><h2>{title}</h2><small>{instruction}</small></div><span className="muted-chip">{selected.length}</span></div>{roster.map(player=><button key={player.id} className={selected.includes(player.id)?"selected":""} onClick={()=>onToggle(player.id)}><span className={`position ${player.position.toLowerCase()}`}>{player.position}</span><span><strong>{player.full_name}</strong><small>{player.club}</small></span><i>{selected.includes(player.id)?"✓":"+"}</i></button>)}</section>;
}

function TradeOffers({trades,userId,managerMap,busy,onRespond,onCancel}:{trades:Trade[];userId:string;managerMap:Map<string,string>;busy:boolean;onRespond:(id:string,accept:boolean)=>void;onCancel:(id:string)=>void}){
  if(!trades.length)return <section className="panel empty-state">No trade offers yet. Build the first offer for your league.</section>;
  return <section className="trade-offer-list">{trades.map(trade=>{const incoming=trade.recipient_id===userId;const mine=incoming?trade.recipient_id:trade.proposer_id;const theirs=incoming?trade.proposer_id:trade.recipient_id;const give=trade.trade_players.filter(item=>item.from_user_id===mine);const receive=trade.trade_players.filter(item=>item.from_user_id===theirs);return <article className="panel trade-offer-card" key={trade.id}><div className="section-row"><div><p className="eyebrow">{incoming?`FROM ${managerMap.get(trade.proposer_id)??"MANAGER"}`:`TO ${managerMap.get(trade.recipient_id)??"MANAGER"}`}</p><h2>{incoming?"Trade received":"Trade sent"}</h2></div><span className={`trade-status ${trade.status}`}>{trade.status}</span></div><div className="offer-sides"><div><small>{incoming?"YOU SEND":"YOU OFFERED"}</small>{give.map(item=><strong key={item.player_id}>{item.players?.full_name??"Player"}</strong>)}</div><span>⇄</span><div><small>{incoming?"YOU RECEIVE":"YOU REQUESTED"}</small>{receive.map(item=><strong key={item.player_id}>{item.players?.full_name??"Player"}</strong>)}</div></div>{trade.note?<p className="trade-note">“{trade.note}”</p>:null}<small className="trade-date">{new Date(trade.created_at).toLocaleString()}</small>{trade.status==="pending"&&incoming?<div className="trade-actions"><button className="decline-button" disabled={busy} onClick={()=>onRespond(trade.id,false)}>Decline</button><button className="primary-button" disabled={busy} onClick={()=>onRespond(trade.id,true)}>Accept trade</button></div>:null}{trade.status==="pending"&&!incoming?<button className="cancel-trade-button" disabled={busy} onClick={()=>onCancel(trade.id)}>Cancel offer</button>:null}</article>})}</section>;
}
