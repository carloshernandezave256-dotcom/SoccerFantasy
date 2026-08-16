"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { PageShell } from "./page-shell";
import { TeamDemo } from "./team-demo";
import { supabase } from "@/lib/supabase";
import { resolveActiveLeague } from "@/lib/active-league";
import { PlayerStatsDialog } from "./player-stats-dialog";
import { getPackHeroCard } from "@/lib/pack-hero-cards";

type League={league_id:string;league_name:string;team_name:string;game_format:string};
type Player={id:number;full_name:string;position:string;club:string;competition?:string};
type Manager={draft_slot:number;user_id:string;team_name:string};
type LineupRow={player_id:number;is_starter:boolean;is_captain:boolean;bench_order:number|null;pitch_order:number|null};

function centerHaaland(order:number[],roster:Player[]){
  const forwards=order.filter(id=>roster.find(player=>player.id===id)?.position==="FWD");
  const haaland=forwards.find(id=>roster.find(player=>player.id===id)?.full_name==="Erling Haaland");
  if(!haaland||forwards.length<3)return order;
  const middle=forwards[Math.floor(forwards.length/2)];
  return order.map(id=>id===haaland?middle:id===middle?haaland:id);
}

function defaultStartingEleven(roster:Player[]){
  const chosen:Player[]=[];
  const add=(players:Player[],limit:number)=>players.slice(0,limit).forEach(player=>{if(!chosen.some(item=>item.id===player.id))chosen.push(player)});
  add(roster.filter(player=>player.position==="GK"),1);
  add(roster.filter(player=>player.position==="DEF"),4);
  add(roster.filter(player=>player.position==="MID"),3);
  add(roster.filter(player=>player.position==="FWD"),3);
  add(roster.filter(player=>player.position!=="GK"&&!chosen.some(item=>item.id===player.id)),11-chosen.length);
  return new Set(chosen.map(player=>player.id));
}

function formationIsValid(roster:Player[],ids:Set<number>){
  const counts=roster.filter(player=>ids.has(player.id)).reduce((all,player)=>({...all,[player.position]:(all[player.position]??0)+1}),{} as Record<string,number>);
  return ids.size===11&&counts.GK===1&&(counts.DEF??0)>=3&&(counts.MID??0)>=1&&(counts.FWD??0)>=1;
}

export function TeamManager(){
  const[leagues,setLeagues]=useState<League[]>([]);
  const[league,setLeague]=useState("");
  const[managers,setManagers]=useState<Manager[]>([]);
  const[userId,setUserId]=useState<string|null>(null);
  const[viewedUser,setViewedUser]=useState("");
  const[roster,setRoster]=useState<Player[]>([]);
  const[starters,setStarters]=useState<Set<number>>(new Set());
  const[starterOrder,setStarterOrder]=useState<number[]>([]);
  const[captain,setCaptain]=useState<number|null>(null);
  const[captainMode,setCaptainMode]=useState(false);
  const[selectedBench,setSelectedBench]=useState<number|null>(null);
  const[editing,setEditing]=useState(false);
  const[message,setMessage]=useState("");
  const[loading,setLoading]=useState(true);
  const[infoPlayer,setInfoPlayer]=useState<Player|null>(null);

  const loadRoster=useCallback(async(id:string,ownerId:string)=>{
    setLoading(true);setMessage("");setRoster([]);setStarters(new Set());setStarterOrder([]);setCaptain(null);setInfoPlayer(null);
    const[{data:draftPicks},{data:packCards},{data:lineup}]=await Promise.all([
      supabase.from("draft_picks").select("player_id,players(id,full_name,position,club,competition)").eq("league_id",id).eq("user_id",ownerId),
      supabase.from("pack_cards").select("player_id,active_slot,players(id,full_name,position,club,competition)").eq("league_id",id).eq("user_id",ownerId).not("active_slot","is",null).order("active_slot"),
      supabase.from("lineup_players").select("player_id,is_starter,is_captain,bench_order,pitch_order").eq("league_id",id).eq("user_id",ownerId),
    ]);
    const saved=(lineup??[]) as LineupRow[];
    const loadedRoster=[...(draftPicks??[]),...(packCards??[])].flatMap(row=>row.players?[row.players as unknown as Player]:[]);
    setRoster(loadedRoster);
    const savedStarterIds=new Set(saved.filter(row=>row.is_starter).map(row=>row.player_id));
    const savedLineupIsValid=formationIsValid(loadedRoster,savedStarterIds);
    const starterIds=savedLineupIsValid?savedStarterIds:defaultStartingEleven(loadedRoster);
    const savedOrder=saved.filter(row=>row.is_starter).sort((a,b)=>(a.pitch_order??999)-(b.pitch_order??999)).map(row=>row.player_id);
    const fallbackOrder=loadedRoster.filter(player=>starterIds.has(player.id)).map(player=>player.id);
    setStarters(starterIds);
    setStarterOrder(savedLineupIsValid&&saved.some(row=>row.is_starter&&row.pitch_order!==null)?savedOrder:centerHaaland(fallbackOrder,loadedRoster));
    const savedCaptain=saved.find(row=>row.is_captain)?.player_id??null;
    setCaptain(savedLineupIsValid&&savedCaptain!==null&&starterIds.has(savedCaptain)?savedCaptain:null);
    setEditing(!savedLineupIsValid);setCaptainMode(false);setSelectedBench(null);setLoading(false);
  },[]);

  const loadLeague=useCallback(async(id:string,preferredUser?:string)=>{
    const{data}=await supabase.rpc("draft_order",{p_league_id:id});
    const list=(data??[]) as Manager[];
    setManagers(list);
    const owner=preferredUser&&list.some(manager=>manager.user_id===preferredUser)?preferredUser:userId&&list.some(manager=>manager.user_id===userId)?userId:list[0]?.user_id??"";
    setViewedUser(owner);
    if(owner)await loadRoster(id,owner);else{setRoster([]);setLoading(false)}
  },[loadRoster,userId]);

  const loadActiveLeague=useCallback(async()=>{
      const{data:{user}}=await supabase.auth.getUser();
      if(!user){setLoading(false);return}
      setUserId(user.id);
      const{data}=await supabase.rpc("my_leagues");
      const list=(data??[]) as League[];
      setLeagues(list);
      const active=resolveActiveLeague(list,new URLSearchParams(window.location.search).get("league"));
      if(active){setLeague(active.league_id);const{data:order}=await supabase.rpc("draft_order",{p_league_id:active.league_id});const managersList=(order??[]) as Manager[];setManagers(managersList);const owner=managersList.some(manager=>manager.user_id===user.id)?user.id:managersList[0]?.user_id??"";setViewedUser(owner);if(owner)await loadRoster(active.league_id,owner)}
      else setLoading(false);
  },[loadRoster]);

  useEffect(()=>{
    void loadActiveLeague();
    const refresh=()=>void loadActiveLeague();
    window.addEventListener("pageshow",refresh);
    window.addEventListener("focus",refresh);
    window.addEventListener("popstate",refresh);
    return()=>{window.removeEventListener("pageshow",refresh);window.removeEventListener("focus",refresh);window.removeEventListener("popstate",refresh)};
  },[loadActiveLeague]);

  const isMine=viewedUser===userId;
  const viewedManager=managers.find(manager=>manager.user_id===viewedUser);
  const showPackCards=leagues.find(item=>item.league_id===league)?.game_format==="pack";

  function tapStarter(id:number){
    if(!isMine||!editing)return;
    if(captainMode){
      setCaptain(id);setCaptainMode(false);setSelectedBench(null);setMessage(`${roster.find(player=>player.id===id)?.full_name} selected as captain.`);return;
    }
    if(selectedBench===null){setMessage("Tap a bench player first, then tap the starter to replace.");return}
    const incoming=roster.find(player=>player.id===selectedBench);
    const outgoing=roster.find(player=>player.id===id);
    const next=new Set(starters);next.delete(id);next.add(selectedBench);
    if(!formationIsValid(roster,next)){setMessage("That switch would create an invalid formation. Keep 1 GK, at least 3 DEF, 1 MID, and 1 FWD.");return}
    setStarters(next);
    setStarterOrder(order=>order.map(playerId=>playerId===id?selectedBench:playerId));
    if(captain===id)setCaptain(null);
    setSelectedBench(null);
    setMessage(`${incoming?.full_name} moved into the XI; ${outgoing?.full_name} moved to the bench.`);
  }

  const counts=useMemo(()=>roster.filter(player=>starters.has(player.id)).reduce((all,player)=>({...all,[player.position]:(all[player.position]??0)+1}),{} as Record<string,number>),[roster,starters]);
  const valid=starters.size===11&&counts.GK===1&&(counts.DEF??0)>=3&&(counts.MID??0)>=1&&(counts.FWD??0)>=1&&captain!==null;

  function reorderStarter(id:number,targetId:number){
    const position=roster.find(player=>player.id===id)?.position;
    if(!position||roster.find(player=>player.id===targetId)?.position!==position)return;
    setStarterOrder(order=>{
      const from=order.indexOf(id),target=order.indexOf(targetId);
      if(from<0||target<0||from===target)return order;
      const next=[...order];
      next.splice(from,1);next.splice(target,0,id);
      return next;
    });
  }

  async function save(){
    if(!isMine||!valid||captain===null){setMessage("Choose a valid starting XI and captain before saving.");return}
    const start=[...starterOrder.filter(id=>starters.has(id)),...[...starters].filter(id=>!starterOrder.includes(id))];
    const bench=roster.filter(player=>!starters.has(player.id)).slice(0,7).map(player=>player.id);
    const{error}=await supabase.rpc("save_lineup",{p_league_id:league,p_starters:start,p_bench:bench,p_captain:captain});
    if(error)setMessage(error.message);else{setMessage("Lineup and captain saved.");setEditing(false);setCaptainMode(false)}
  }

  return <PageShell eyebrow={viewedManager?.team_name??leagues.find(item=>item.league_id===league)?.team_name??"MY CLUB"} title={isMine?"My Team":"Team Viewer"}>
    <div className="team-selectors">
      <label>View team<select className="league-select" value={viewedUser} onChange={event=>{setViewedUser(event.target.value);void loadRoster(league,event.target.value)}}>{managers.map(manager=><option key={manager.user_id} value={manager.user_id}>{manager.user_id===userId?"My Team":manager.team_name}</option>)}</select></label>
    </div>

    {loading?<section className="panel empty-state">Loading squad…</section>:roster.length===0?(showPackCards&&isMine?<section className="panel empty-state"><strong>Your pack squad is waiting.</strong><p>Open your starter bundle first. Every packed player will save to this league, and the first 18 unique cards will refresh into My Team automatically.</p><Link className="primary-button full-button" href={`/packs?league=${league}`}>Open starter bundle</Link></section>:isMine?<TeamDemo/>:<section className="panel empty-state"><strong>{viewedManager?.team_name} has no players yet.</strong><p>{showPackCards?"Their packed players will appear here after they open a starter bundle.":"Their drafted squad will appear here as picks are made."}</p></section>):<>
      <section className="formation-card"><div><small>{isMine?"STARTING XI":viewedManager?.team_name?.toUpperCase()}</small><strong>{starters.size===11?`${counts.DEF??0}-${counts.MID??0}-${counts.FWD??0}`:`${starters.size}/11`}</strong></div><div className="formation-counts"><span>GK {counts.GK??0}</span><span>DEF {counts.DEF??0}</span><span>MID {counts.MID??0}</span><span>FWD {counts.FWD??0}</span></div></section>
      {isMine&&editing?<><div className="team-controls"><button className={captainMode?"active":""} onClick={()=>{setCaptainMode(active=>!active);setSelectedBench(null);setMessage("Captain mode: tap one of your starters on the pitch.")}}>© Set captain</button><span className={valid?"valid":"invalid"}>{valid?"✓ Ready to save":"! Choose a captain"}</span></div><p className="team-instruction">{message||"Tap for player info, or press and drag a starter within their position row."}</p><SavedTeamPitch roster={roster} starters={starters} starterOrder={starterOrder} captain={captain} showPackCards={showPackCards} editing captainMode={captainMode} selectedBench={selectedBench} onInfo={id=>setInfoPlayer(roster.find(player=>player.id===id)??null)} onStarter={tapStarter} onReorder={reorderStarter} onBench={id=>{setCaptainMode(false);setSelectedBench(id);setMessage(`${roster.find(player=>player.id===id)?.full_name} selected. Now tap a starter on the pitch.`)}}/><button className="primary-button full-button" disabled={!valid} onClick={save}>Save lineup</button></>:<><SavedTeamPitch roster={roster} starters={starters} starterOrder={starterOrder} captain={captain} showPackCards={showPackCards} allowDrag={isMine} onReorder={(id,targetId)=>{setEditing(true);setMessage("Player moved. Save your lineup to keep the new order.");reorderStarter(id,targetId)}} onInfo={id=>setInfoPlayer(roster.find(player=>player.id===id)??null)} onBench={id=>setInfoPlayer(roster.find(player=>player.id===id)??null)}/>{isMine?<button className="primary-button full-button edit-lineup-button" onClick={()=>{setEditing(true);setSelectedBench(null);setMessage("Tap for player info, or press and drag a starter within their position row.")}}>Edit lineup</button>:<div className="view-only-banner">Viewing {viewedManager?.team_name} · Read only</div>}</>}
    </>}
    {message&&isMine?<p className="form-message">{message}</p>:null}
    {infoPlayer?<PlayerStatsDialog leagueId={league} player={infoPlayer} onClose={()=>setInfoPlayer(null)}/>:null}
  </PageShell>;
}

function SavedTeamPitch({roster,starters,starterOrder,captain,editing=false,allowDrag=editing,captainMode=false,selectedBench=null,onStarter,onBench,onReorder,onInfo,showPackCards=false}:{roster:Player[];starters:Set<number>;starterOrder:number[];captain:number|null;editing?:boolean;allowDrag?:boolean;captainMode?:boolean;selectedBench?:number|null;onStarter?:(id:number)=>void;onBench?:(id:number)=>void;onReorder?:(id:number,targetId:number)=>void;onInfo?:(id:number)=>void;showPackCards?:boolean}){
  const[pitchDrag,setPitchDrag]=useState<{id:number;targetId:number;position:string;top:number;left:number;width:number;height:number;offsetX:number;offsetY:number;moved:boolean}|null>(null);
  const pitchDragRef=useRef<typeof pitchDrag>(null);
  const selected=[...starterOrder.filter(id=>starters.has(id)),...[...starters].filter(id=>!starterOrder.includes(id))].flatMap(id=>{const player=roster.find(item=>item.id===id);return player?[player]:[]});
  const positionRank:Record<string,number>={GK:0,DEF:1,MID:2,FWD:3};
  const bench=roster.filter(player=>!starters.has(player.id)).sort((a,b)=>(positionRank[a.position]??9)-(positionRank[b.position]??9)||a.full_name.localeCompare(b.full_name));
  const groups={FWD:selected.filter(player=>player.position==="FWD"),MID:selected.filter(player=>player.position==="MID"),DEF:selected.filter(player=>player.position==="DEF"),GK:selected.filter(player=>player.position==="GK")};
  function beginPitchDrag(event:React.PointerEvent<HTMLButtonElement>,player:Player){
    if(captainMode)return;
    const slot=event.currentTarget.closest<HTMLElement>(".pitch-player-slot");if(!slot)return;
    const rect=slot.getBoundingClientRect();event.currentTarget.setPointerCapture(event.pointerId);
    const drag={id:player.id,targetId:player.id,position:player.position,top:rect.top,left:rect.left,width:rect.width,height:rect.height,offsetX:event.clientX-rect.left,offsetY:event.clientY-rect.top,moved:false};
    pitchDragRef.current=drag;setPitchDrag(drag);
  }
  function updatePitchDrag(event:React.PointerEvent<HTMLButtonElement>){
    const active=pitchDragRef.current;if(!active)return;
    const moved=allowDrag&&(active.moved||Math.hypot(event.clientX-(active.left+active.offsetX),event.clientY-(active.top+active.offsetY))>7);
    const slots=Array.from(document.querySelectorAll<HTMLElement>(`.pitch-player-slot[data-position="${active.position}"]`));
    let targetId=active.id,best=Infinity;
    for(const slot of slots){const rect=slot.getBoundingClientRect(),distance=Math.abs(event.clientX-(rect.left+rect.width/2));if(distance<best){best=distance;targetId=Number(slot.dataset.playerId)}}
    const next={...active,targetId,top:event.clientY-active.offsetY,left:event.clientX-active.offsetX,moved};pitchDragRef.current=next;setPitchDrag(next);
  }
  function finishPitchDrag(event:React.PointerEvent<HTMLButtonElement>){
    const active=pitchDragRef.current;if(!active)return;
    if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
    pitchDragRef.current=null;setPitchDrag(null);
    if(active.moved&&active.targetId!==active.id)onReorder?.(active.id,active.targetId);else if(!active.moved){if(captainMode||selectedBench!==null)onStarter?.(active.id);else onInfo?.(active.id)}
  }
  const draggedPlayer=pitchDrag?roster.find(player=>player.id===pitchDrag.id):null;
  return <><section className={`mini-pitch saved-team-pitch ${captainMode?"captain-mode":""} ${pitchDrag?.moved?"is-reordering":""}`} aria-label="Starting eleven mini pitch"><div className="pitch-box top-box"/><div className="center-line"/><div className="center-circle"/><div className="pitch-box bottom-box"/>{(["FWD","MID","DEF","GK"] as const).map(position=><div className={`pitch-row row-${position.toLowerCase()}`} style={{gridTemplateColumns:`repeat(${Math.max(groups[position].length,1)}, minmax(0, 1fr))`}} key={position}>{groups[position].map(player=><PitchPlayer key={player.id} player={player} editing={editing} captain={captain} captainMode={captainMode} selectedBench={selectedBench} showPackCards={showPackCards} pitchDrag={pitchDrag} onPointerDown={beginPitchDrag} onPointerMove={updatePitchDrag} onPointerUp={finishPitchDrag} onStarter={onStarter}/>)}</div>)}</section>{pitchDrag?.moved&&draggedPlayer?<PitchDragGhost player={draggedPlayer} drag={pitchDrag} showPackCards={showPackCards}/>:null}<section className="panel demo-bench saved-team-bench"><div className="section-row"><div><h2>Bench</h2><small>{editing?"Select one, then replace a starter above":"Your substitutes"}</small></div><span className="muted-chip">{bench.length}/7</span></div><div className="bench-scroll">{bench.map((player,index)=><button type="button" className={`saved-bench-player ${selectedBench===player.id?"selected":""}`} key={player.id} onClick={()=>onBench?.(player.id)} aria-disabled={!editing}><span>{index+1}</span><i className={`position ${player.position.toLowerCase()}`}>{player.position}</i><strong>{player.full_name}</strong><small>{player.club}</small></button>)}</div></section></>;
}

type PitchDrag={id:number;targetId:number;position:string;top:number;left:number;width:number;height:number;offsetX:number;offsetY:number;moved:boolean};

function PitchPlayer({player,editing,captain,captainMode,selectedBench,showPackCards,pitchDrag,onPointerDown,onPointerMove,onPointerUp,onStarter}:{player:Player;editing:boolean;captain:number|null;captainMode:boolean;selectedBench:number|null;showPackCards:boolean;pitchDrag:PitchDrag|null;onPointerDown:(event:React.PointerEvent<HTMLButtonElement>,player:Player)=>void;onPointerMove:(event:React.PointerEvent<HTMLButtonElement>)=>void;onPointerUp:(event:React.PointerEvent<HTMLButtonElement>)=>void;onStarter?:((id:number)=>void)}){
 const hero=showPackCards?getPackHeroCard(player.full_name):null;
 return <div className={`pitch-player-slot ${pitchDrag?.moved&&pitchDrag.id===player.id?"pitch-drag-source":""} ${pitchDrag?.moved&&pitchDrag.targetId===player.id&&pitchDrag.id!==player.id?"pitch-drop-target":""}`} data-position={player.position} data-player-id={player.id}><button type="button" className="saved-pitch-player" onPointerDown={event=>onPointerDown(event,player)} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onClick={event=>{event.preventDefault();if(captainMode)onStarter?.(player.id)}} aria-disabled={!editing}><span className={`shirt shirt-${player.position.toLowerCase()} ${hero?"mini-card-shirt":""}`}>{hero?<img src={hero.src} alt=""/>:null}{captain===player.id?<b>C</b>:null}</span><strong>{player.full_name}</strong><small>{player.club}</small></button></div>
}

function PitchDragGhost({player,drag,showPackCards}:{player:Player;drag:PitchDrag;showPackCards:boolean}){
 const hero=showPackCards?getPackHeroCard(player.full_name):null;
 return <div className="pitch-drag-ghost" aria-hidden="true" style={{top:drag.top,left:drag.left,width:drag.width,height:drag.height}}><span className={`shirt shirt-${player.position.toLowerCase()} ${hero?"mini-card-shirt":""}`}>{hero?<img src={hero.src} alt=""/>:null}</span><strong>{player.full_name}</strong><small>{player.position} row</small></div>
}
