"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageShell } from "./page-shell";
import { supabase } from "@/lib/supabase";

type Player = { id:number; full_name:string; position:string; club:string; competition:string; draft_rank:number|null };
type Draft = { id:string; status:"waiting"|"live"|"paused"|"complete"; current_pick:number; pick_deadline:string|null; pick_seconds:number };
type Pick = { id:number; pick_number:number; round:number; user_id:string; player_id:number; auto_picked:boolean; players?:{full_name:string}|null };
type Manager = { draft_slot:number; user_id:string; team_name:string };
type QueueItem = { player_id:number; priority:number; players?:Player|null };
type QueueDrag = { index:number; target:number; top:number; left:number; width:number; height:number; pointerOffsetY:number };

function managerAtPick(order:Manager[],pickNumber:number){
  const count=order.length;
  if(!count)return undefined;
  const round=Math.floor((pickNumber-1)/count)+1;
  const index=(pickNumber-1)%count;
  const slot=round%2?index+1:count-index;
  return order.find(manager=>manager.draft_slot===slot);
}

export function DraftRoom({leagueId}:{leagueId:string}){
  const[draft,setDraft]=useState<Draft|null>(null);
  const[players,setPlayers]=useState<Player[]>([]);
  const[picks,setPicks]=useState<Pick[]>([]);
  const[order,setOrder]=useState<Manager[]>([]);
  const[userId,setUserId]=useState<string|null>(null);
  const[query,setQuery]=useState("");
  const[position,setPosition]=useState("ALL");
  const[view,setView]=useState<"available"|"queue"|"team">("available");
  const[visibleCount,setVisibleCount]=useState(30);
  const[message,setMessage]=useState("");
  const[now,setNow]=useState(Date.now());
  const[queue,setQueue]=useState<QueueItem[]>([]);
  const[queueSaving,setQueueSaving]=useState(false);
  const[queueDrag,setQueueDrag]=useState<QueueDrag|null>(null);
  const queueDragRef=useRef<QueueDrag|null>(null);
  const queueListRef=useRef<HTMLElement|null>(null);

  const load=useCallback(async()=>{
    if(!leagueId)return;
    const[auth,draftResult,picksResult,orderResult,playersResult,queueResult]=await Promise.all([
      supabase.auth.getUser(),
      supabase.from("drafts").select("id,status,current_pick,pick_deadline,pick_seconds").eq("league_id",leagueId).maybeSingle(),
      supabase.from("draft_picks").select("id,pick_number,round,user_id,player_id,auto_picked,players(full_name)").eq("league_id",leagueId).order("pick_number",{ascending:false}),
      supabase.rpc("draft_order",{p_league_id:leagueId}),
      supabase.from("players").select("id,full_name,position,club,competition,draft_rank").eq("active",true).order("draft_rank",{ascending:true,nullsFirst:false}),
      supabase.from("draft_queue").select("player_id,priority,players(id,full_name,position,club,competition,draft_rank)").eq("league_id",leagueId).order("priority"),
    ]);
    setUserId(auth.data.user?.id??null);
    setDraft((draftResult.data as Draft|null)??null);
    setPicks((picksResult.data??[]) as unknown as Pick[]);
    setOrder((orderResult.data??[]) as Manager[]);
    setPlayers((playersResult.data??[]) as Player[]);
    setQueue((queueResult.data??[]) as unknown as QueueItem[]);
  },[leagueId]);

  useEffect(()=>{
    void load();
    const timer=setInterval(()=>setNow(Date.now()),1000);
    if(!leagueId)return()=>clearInterval(timer);
    const channel=supabase.channel(`draft:${leagueId}`)
      .on("postgres_changes",{event:"*",schema:"public",table:"drafts",filter:`league_id=eq.${leagueId}`},()=>void load())
      .on("postgres_changes",{event:"INSERT",schema:"public",table:"draft_picks",filter:`league_id=eq.${leagueId}`},()=>void load())
      .subscribe();
    return()=>{clearInterval(timer);void supabase.removeChannel(channel)};
  },[leagueId,load]);

  const managerCount=order.length;
  const currentPick=draft?.current_pick??1;
  const round=managerCount?Math.floor((currentPick-1)/managerCount)+1:1;
  const onClock=managerAtPick(order,currentPick);
  const nextManager=managerAtPick(order,currentPick+1);
  const isMyTurn=draft?.status==="live"&&onClock?.user_id===userId;
  const pickedIds=useMemo(()=>new Set(picks.map(pick=>pick.player_id)),[picks]);
  const seconds=draft?.pick_deadline?Math.max(0,Math.ceil((new Date(draft.pick_deadline).getTime()-now)/1000)):0;
  const available=useMemo(()=>players.filter(player=>!pickedIds.has(player.id)&&(position==="ALL"||player.position===position)&&`${player.full_name} ${player.club}`.toLowerCase().includes(query.toLowerCase())),[players,pickedIds,position,query]);
  const myPicks=useMemo(()=>picks.filter(pick=>pick.user_id===userId).sort((a,b)=>a.pick_number-b.pick_number).map(pick=>({pick,player:players.find(player=>player.id===pick.player_id)})),[picks,players,userId]);
  const rosterCounts=useMemo(()=>myPicks.reduce((counts,item)=>{if(item.player)counts[item.player.position]=(counts[item.player.position]??0)+1;return counts},{GK:0,DEF:0,MID:0,FWD:0} as Record<string,number>),[myPicks]);
  const rosterTargets={GK:2,DEF:6,MID:5,FWD:5};

  useEffect(()=>setVisibleCount(30),[query,position]);

  async function start(){
    setMessage("");
    const{error}=await supabase.rpc("start_draft",{p_league_id:leagueId,p_pick_seconds:90});
    setMessage(error?.message??"Draft started. The first manager is on the clock.");
    await load();
  }

  async function saveQueue(ids:number[]){
    setQueueSaving(true);
    setMessage("");
    const{error}=await supabase.rpc("set_draft_queue",{p_league_id:leagueId,p_player_ids:ids});
    setMessage(error?.message??"Draft queue saved.");
    await load();
    setQueueSaving(false);
  }

  function addToQueue(player:Player){
    if(queue.some(item=>item.player_id===player.id)||queue.length>=25)return;
    void saveQueue([...queue.map(item=>item.player_id),player.id]);
  }

  function moveQueue(index:number,target:number){
    if(target<0||target>=queue.length||target===index)return;
    const ids=queue.map(item=>item.player_id);
    const[moved]=ids.splice(index,1);ids.splice(target,0,moved);
    void saveQueue(ids);
  }

  function beginQueueDrag(event:React.PointerEvent<HTMLButtonElement>,index:number){
    if(queueSaving)return;
    const row=event.currentTarget.closest<HTMLElement>("[data-queue-index]");
    if(!row)return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect=row.getBoundingClientRect();
    const drag={index,target:index,top:rect.top,left:rect.left,width:rect.width,height:rect.height,pointerOffsetY:event.clientY-rect.top};
    queueDragRef.current=drag;
    setQueueDrag(drag);
  }

  function updateQueueDrag(event:React.PointerEvent<HTMLButtonElement>){
    const active=queueDragRef.current;
    if(!active)return;
    event.preventDefault();
    const rows=Array.from(queueListRef.current?.querySelectorAll<HTMLElement>("[data-queue-index]")??[]);
    let target=active.index;
    for(const row of rows){
      const index=Number(row.dataset.queueIndex);
      if(index===active.index)continue;
      const rect=row.getBoundingClientRect();
      if(event.clientY>rect.top+rect.height/2)target=index;
      else if(event.clientY<rect.top+rect.height/2){target=index;break}
    }
    if(event.clientY<rows[0]?.getBoundingClientRect().top!)target=0;
    if(event.clientY>rows.at(-1)?.getBoundingClientRect().bottom!)target=queue.length-1;
    const next={...active,target,top:event.clientY-active.pointerOffsetY};
    queueDragRef.current=next;
    setQueueDrag(next);
    const edge=72;
    if(event.clientY<edge)window.scrollBy({top:-12,behavior:"auto"});
    else if(event.clientY>window.innerHeight-edge)window.scrollBy({top:12,behavior:"auto"});
  }

  function finishQueueDrag(event:React.PointerEvent<HTMLButtonElement>){
    const active=queueDragRef.current;
    if(!active)return;
    if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
    queueDragRef.current=null;
    setQueueDrag(null);
    moveQueue(active.index,active.target);
  }

  function removeFromQueue(item:QueueItem){
    if(window.confirm(`Remove ${item.players?.full_name??"this player"} from your queue?`))void saveQueue(queue.filter(entry=>entry.player_id!==item.player_id).map(entry=>entry.player_id));
  }

  async function pick(id:number){
    if(!isMyTurn)return;
    setMessage("");
    const{error}=await supabase.rpc("make_draft_pick",{p_league_id:leagueId,p_player_id:id});
    setMessage(error?.message??"Pick confirmed. The clock moved to the next manager.");
    await load();
  }

  if(!leagueId)return <PageShell eyebrow="LIVE DRAFT" title="Select a league"><section className="panel empty-state">Open the League tab and choose a league’s Draft Room.</section></PageShell>;

  if(draft?.status==="complete")return <PageShell eyebrow="DRAFT COMPLETE" title="Your squad is ready"><section className="panel draft-finished"><span>✓</span><h2>The draft is now closed</h2><p>All 18 rounds are complete. Set your starting lineup and choose your captain.</p><Link className="primary-button" href={`/team?league=${leagueId}`}>Set your lineup</Link></section></PageShell>;

  return <PageShell eyebrow={`ROUND ${round} · PICK ${currentPick}`} title="Draft room">
    <section className={`draft-clock ${isMyTurn?"my-turn":""}`}>
      <div>
        <small>{isMyTurn?"YOUR PICK":"ON THE CLOCK"}</small>
        <strong>{onClock?.team_name??"Waiting for commissioner"}</strong>
        {draft?.status==="live"?<span>Next: {nextManager?.team_name??"Draft complete"}</span>:null}
      </div>
      <b>{String(Math.floor(seconds/60)).padStart(2,"0")}:{String(seconds%60).padStart(2,"0")}</b>
    </section>

    {draft?.status==="live"?<p className="draft-help">{seconds>0?`Each pick gets ${draft.pick_seconds} seconds. At 00:00, auto-pick uses that manager’s first valid queued player, then the highest-ranked player that fits the roster.`:"Time expired — processing the automatic pick…"}</p>:null}

    {!draft?<><button className="primary-button full-button" onClick={start} disabled={managerCount<3}>{managerCount>=3?"Start 18-round draft":`Waiting for ${3-managerCount} more manager${3-managerCount===1?"":"s"}`}</button><p className="form-message">{managerCount}/3 managers required to start. League capacity stays unchanged.</p></>:null}
    {draft?.status==="paused"?<p className="draft-alert">Draft paused because the available player pool needs attention.</p>:null}
    {message?<p className="form-message">{message}</p>:null}

    <section className="draft-order" aria-label="Draft order">{order.map(manager=><span className={manager.user_id===onClock?.user_id&&draft?.status==="live"?"active":""} key={manager.user_id}>{manager.draft_slot}. {manager.team_name}</span>)}</section>

    <div className="draft-view-tabs" role="tablist"><button className={view==="available"?"active":""} onClick={()=>setView("available")}>Available</button><button className={view==="queue"?"active":""} onClick={()=>setView("queue")}>My Queue <span>{queue.length}</span></button><button className={view==="team"?"active":""} onClick={()=>setView("team")}>My Picks <span>{myPicks.length}/18</span></button></div>

    {view==="available"?<>
      <label className="draft-search-label" htmlFor="draft-player-search">Find a player</label>
      <div className="search-box">⌕<input id="draft-player-search" placeholder="Search by player or club" value={query} onChange={event=>setQuery(event.target.value)}/></div>
      <div className="filter-row">{["ALL","GK","DEF","MID","FWD"].map(value=><button key={value} className={position===value?"active":""} onClick={()=>setPosition(value)}>{value}</button>)}</div>
      <p className="player-result-count">Showing {Math.min(visibleCount,available.length)} of {available.length} available players</p>
      <section className="panel player-list draft-list">{available.slice(0,visibleCount).map(player=><article key={player.id}>
        <span className={`position ${player.position.toLowerCase()}`}>{player.position}</span>
        <div><strong>{player.full_name}</strong><small>#{player.draft_rank??"—"} · {player.club} · {player.competition}</small></div>
        <div className="player-actions"><button className="queue-button" onClick={()=>addToQueue(player)} disabled={queueSaving||queue.some(item=>item.player_id===player.id)||queue.length>=25}>{queue.some(item=>item.player_id===player.id)?"QUEUED":"+ QUEUE"}</button><button className="draft-button" onClick={()=>pick(player.id)} disabled={!isMyTurn}>{isMyTurn?"DRAFT":"WAIT"}</button></div>
      </article>)}{available.length===0?<p className="queue-empty">No available players match that search.</p>:null}</section>
      {visibleCount<available.length?<button className="secondary-button full-button load-more" onClick={()=>setVisibleCount(count=>count+30)}>Show 30 more</button>:null}
    </>:view==="queue"?<section ref={queueListRef} className={`panel draft-queue queue-tab-panel ${queueDrag?"is-reordering":""}`}>
      <div className="section-row"><div><h2>My auto-pick priority</h2><p>Drag the three-line handle to reorder. You can also draft directly from this list.</p></div><span className="muted-chip">{queue.length}/25</span></div>
      {queue.length===0?<p className="queue-empty">Your queue is empty. Open Available and tap + QUEUE beside players you want. If it remains empty, auto-pick uses the highest-ranked player your roster needs.</p>:queue.map((item,index)=><article data-queue-index={index} className={`${queueDrag?.index===index?"queue-drag-source":""} ${queueDrag?.target===index&&queueDrag.index!==index?(queueDrag.index<index?"queue-drop-after":"queue-drop-before"):""}`} key={item.player_id}>
        <button className="queue-drag" disabled={queueSaving} onPointerDown={event=>beginQueueDrag(event,index)} onPointerMove={updateQueueDrag} onPointerUp={finishQueueDrag} onPointerCancel={finishQueueDrag} aria-label={`Reorder ${item.players?.full_name??"player"}`}>☰</button><span className={`position ${(item.players?.position??"").toLowerCase()}`}>{item.players?.position}</span>
        <div><strong>{item.players?.full_name??`Player ${item.player_id}`}</strong><small>#{item.players?.draft_rank??"—"} · {item.players?.club}</small></div>
        <div className="queue-actions"><button className="draft-button" disabled={queueSaving||!isMyTurn} onClick={()=>pick(item.player_id)}>{isMyTurn?"DRAFT":"WAIT"}</button><button className="queue-remove" disabled={queueSaving} onClick={()=>removeFromQueue(item)} aria-label={`Remove ${item.players?.full_name??"player"}`}>×</button></div>
      </article>)}
      {queueDrag?(()=>{const item=queue[queueDrag.index];return <article className="queue-drag-ghost" aria-hidden="true" style={{top:queueDrag.top,left:queueDrag.left,width:queueDrag.width,height:queueDrag.height}}><span className="queue-drag ghost-handle">☰</span><span className={`position ${(item.players?.position??"").toLowerCase()}`}>{item.players?.position}</span><div><strong>{item.players?.full_name??`Player ${item.player_id}`}</strong><small>Drop at position {queueDrag.target+1}</small></div><b className="queue-ghost-rank">#{queueDrag.target+1}</b></article>})():null}
    </section>:<>
      <section className="roster-needs" aria-label="Roster progress">{(["GK","DEF","MID","FWD"] as const).map(pos=>{const have=rosterCounts[pos];const target=rosterTargets[pos];const missing=Math.max(0,target-have);return <article key={pos} className={missing===0?"complete":""}><b>{pos}</b><strong>{have}/{target}</strong><small>{missing===0?"Complete":`${missing} needed`}</small></article>})}</section>
      <section className="panel player-list my-picks-list">{myPicks.map(({pick,player})=><article key={pick.id}><b className="owned-pick-number">#{pick.pick_number}</b><span className={`position ${(player?.position??"").toLowerCase()}`}>{player?.position}</span><div><strong>{player?.full_name??`Player ${pick.player_id}`}</strong><small>{player?.club}{pick.auto_picked?" · AUTO-PICK":""}</small></div></article>)}{myPicks.length===0?<p className="queue-empty">You have not drafted a player yet. Your picks will appear here as soon as they are made.</p>:null}</section>
    </>}

    <section className="panel"><div className="section-row"><h2>Recent picks</h2><span className="muted-chip">{picks.length}</span></div>{picks.slice(0,8).map(pick=><div className="pick-row" key={pick.id}><b>#{pick.pick_number}</b><span>{pick.players?.full_name??`Player ${pick.player_id}`}</span><small>{order.find(manager=>manager.user_id===pick.user_id)?.team_name}{pick.auto_picked?" · AUTO":""}</small></div>)}</section>
  </PageShell>;
}
