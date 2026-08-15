"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageShell } from "./page-shell";
import { TeamDemo } from "./team-demo";
import { supabase } from "@/lib/supabase";
import { resolveActiveLeague } from "@/lib/active-league";

type League={league_id:string;league_name:string;team_name:string;game_format:string};
type Player={id:number;full_name:string;position:string;club:string};
type Manager={draft_slot:number;user_id:string;team_name:string};
type LineupRow={player_id:number;is_starter:boolean;is_captain:boolean;bench_order:number|null};

function defaultStartingEleven(roster:Player[]){
  const chosen:Player[]=[];
  const add=(players:Player[],limit:number)=>players.slice(0,limit).forEach(player=>{if(!chosen.some(item=>item.id===player.id))chosen.push(player)});
  add(roster.filter(player=>player.position==="GK"),1);
  add(roster.filter(player=>player.position==="DEF"),3);
  add(roster.filter(player=>player.position==="MID"),1);
  add(roster.filter(player=>player.position==="FWD"),1);
  add(roster.filter(player=>!chosen.some(item=>item.id===player.id)),11-chosen.length);
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
  const[captain,setCaptain]=useState<number|null>(null);
  const[captainMode,setCaptainMode]=useState(false);
  const[selectedBench,setSelectedBench]=useState<number|null>(null);
  const[editing,setEditing]=useState(false);
  const[message,setMessage]=useState("");
  const[loading,setLoading]=useState(true);

  const loadRoster=useCallback(async(id:string,ownerId:string)=>{
    setLoading(true);setMessage("");
    const[{data:draftPicks},{data:packCards},{data:lineup}]=await Promise.all([
      supabase.from("draft_picks").select("player_id,players(id,full_name,position,club)").eq("league_id",id).eq("user_id",ownerId),
      supabase.from("pack_cards").select("player_id,players(id,full_name,position,club)").eq("league_id",id).eq("user_id",ownerId).not("active_slot","is",null),
      supabase.from("lineup_players").select("player_id,is_starter,is_captain,bench_order").eq("league_id",id).eq("user_id",ownerId),
    ]);
    const saved=(lineup??[]) as LineupRow[];
    const loadedRoster=[...(draftPicks??[]),...(packCards??[])].flatMap(row=>row.players?[row.players as unknown as Player]:[]);
    setRoster(loadedRoster);
    setStarters(saved.length?new Set(saved.filter(row=>row.is_starter).map(row=>row.player_id)):defaultStartingEleven(loadedRoster));
    setCaptain(saved.find(row=>row.is_captain)?.player_id??null);
    setEditing(saved.length===0);setCaptainMode(false);setSelectedBench(null);setLoading(false);
  },[]);

  const loadLeague=useCallback(async(id:string,preferredUser?:string)=>{
    const{data}=await supabase.rpc("draft_order",{p_league_id:id});
    const list=(data??[]) as Manager[];
    setManagers(list);
    const owner=preferredUser&&list.some(manager=>manager.user_id===preferredUser)?preferredUser:userId&&list.some(manager=>manager.user_id===userId)?userId:list[0]?.user_id??"";
    setViewedUser(owner);
    if(owner)await loadRoster(id,owner);else{setRoster([]);setLoading(false)}
  },[loadRoster,userId]);

  useEffect(()=>{
    void(async()=>{
      const{data:{user}}=await supabase.auth.getUser();
      if(!user){setLoading(false);return}
      setUserId(user.id);
      const{data}=await supabase.rpc("my_leagues");
      const list=(data??[]) as League[];
      setLeagues(list);
      const active=resolveActiveLeague(list,new URLSearchParams(window.location.search).get("league"));
      if(active){setLeague(active.league_id);const{data:order}=await supabase.rpc("draft_order",{p_league_id:active.league_id});const managersList=(order??[]) as Manager[];setManagers(managersList);const owner=managersList.some(manager=>manager.user_id===user.id)?user.id:managersList[0]?.user_id??"";setViewedUser(owner);if(owner)await loadRoster(active.league_id,owner)}
      else setLoading(false);
    })();
  },[loadRoster]);

  const isMine=viewedUser===userId;
  const viewedManager=managers.find(manager=>manager.user_id===viewedUser);

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
    if(captain===id)setCaptain(null);
    setSelectedBench(null);
    setMessage(`${incoming?.full_name} moved into the XI; ${outgoing?.full_name} moved to the bench.`);
  }

  const counts=useMemo(()=>roster.filter(player=>starters.has(player.id)).reduce((all,player)=>({...all,[player.position]:(all[player.position]??0)+1}),{} as Record<string,number>),[roster,starters]);
  const valid=starters.size===11&&counts.GK===1&&(counts.DEF??0)>=3&&(counts.MID??0)>=1&&(counts.FWD??0)>=1&&captain!==null;

  async function save(){
    if(!isMine||!valid||captain===null){setMessage("Choose a valid starting XI and captain before saving.");return}
    const start=[...starters];
    const bench=roster.filter(player=>!starters.has(player.id)).slice(0,7).map(player=>player.id);
    const{error}=await supabase.rpc("save_lineup",{p_league_id:league,p_starters:start,p_bench:bench,p_captain:captain});
    if(error)setMessage(error.message);else{setMessage("Lineup and captain saved.");setEditing(false);setCaptainMode(false)}
  }

  return <PageShell eyebrow={viewedManager?.team_name??leagues.find(item=>item.league_id===league)?.team_name??"MY CLUB"} title={isMine?"My Team":"Team Viewer"}>
    <div className="team-selectors">
      <label>View team<select className="league-select" value={viewedUser} onChange={event=>{setViewedUser(event.target.value);void loadRoster(league,event.target.value)}}>{managers.map(manager=><option key={manager.user_id} value={manager.user_id}>{manager.user_id===userId?"My Team":manager.team_name}</option>)}</select></label>
    </div>

    {loading?<section className="panel empty-state">Loading squad…</section>:roster.length===0?(isMine?<TeamDemo/>:<section className="panel empty-state"><strong>{viewedManager?.team_name} has no players yet.</strong><p>Their drafted squad will appear here as picks are made.</p></section>):<>
      <section className="formation-card"><div><small>{isMine?"STARTING XI":viewedManager?.team_name?.toUpperCase()}</small><strong>{starters.size===11?`${counts.DEF??0}-${counts.MID??0}-${counts.FWD??0}`:`${starters.size}/11`}</strong></div><div className="formation-counts"><span>GK {counts.GK??0}</span><span>DEF {counts.DEF??0}</span><span>MID {counts.MID??0}</span><span>FWD {counts.FWD??0}</span></div></section>
      {isMine&&editing?<><div className="team-controls"><button className={captainMode?"active":""} onClick={()=>{setCaptainMode(active=>!active);setSelectedBench(null);setMessage("Captain mode: tap one of your starters on the pitch.")}}>© Set captain</button><span className={valid?"valid":"invalid"}>{valid?"✓ Ready to save":"! Choose a captain"}</span></div><p className="team-instruction">{message||"Tap a bench player, then tap the starter you want to replace."}</p><SavedTeamPitch roster={roster} starters={starters} captain={captain} editing captainMode={captainMode} selectedBench={selectedBench} onStarter={tapStarter} onBench={id=>{setCaptainMode(false);setSelectedBench(id);setMessage(`${roster.find(player=>player.id===id)?.full_name} selected. Now tap a starter on the pitch.`)}}/><button className="primary-button full-button" disabled={!valid} onClick={save}>Save lineup</button></>:<><SavedTeamPitch roster={roster} starters={starters} captain={captain}/>{isMine?<button className="primary-button full-button edit-lineup-button" onClick={()=>{setEditing(true);setSelectedBench(null);setMessage("Tap a bench player, then tap the starter you want to replace.")}}>Edit lineup</button>:<div className="view-only-banner">Viewing {viewedManager?.team_name} · Read only</div>}</>}
    </>}
    {message&&isMine?<p className="form-message">{message}</p>:null}
  </PageShell>;
}

function SavedTeamPitch({roster,starters,captain,editing=false,captainMode=false,selectedBench=null,onStarter,onBench}:{roster:Player[];starters:Set<number>;captain:number|null;editing?:boolean;captainMode?:boolean;selectedBench?:number|null;onStarter?:(id:number)=>void;onBench?:(id:number)=>void}){
  const selected=roster.filter(player=>starters.has(player.id));
  const bench=roster.filter(player=>!starters.has(player.id));
  const groups={FWD:selected.filter(player=>player.position==="FWD"),MID:selected.filter(player=>player.position==="MID"),DEF:selected.filter(player=>player.position==="DEF"),GK:selected.filter(player=>player.position==="GK")};
  return <><section className={`mini-pitch saved-team-pitch ${captainMode?"captain-mode":""}`} aria-label="Starting eleven mini pitch"><div className="pitch-box top-box"/><div className="center-line"/><div className="center-circle"/><div className="pitch-box bottom-box"/>{(["FWD","MID","DEF","GK"] as const).map(position=><div className={`pitch-row row-${position.toLowerCase()}`} key={position}>{groups[position].map(player=><button type="button" className="saved-pitch-player" key={player.id} onClick={()=>onStarter?.(player.id)} aria-disabled={!editing}><span className={`shirt shirt-${player.position.toLowerCase()} ${player.full_name==="Virgil van Dijk"||player.full_name==="Erling Haaland"?"mini-card-shirt":""}`}>{player.full_name==="Virgil van Dijk"?<img src="https://raw.githubusercontent.com/carloshernandezave256-dotcom/SoccerFantasy/main/public/cards/van-dijk-captain.webp" alt=""/>:player.full_name==="Erling Haaland"?<img src="https://raw.githubusercontent.com/carloshernandezave256-dotcom/SoccerFantasy/main/public/cards/haaland-superstar.webp" alt=""/>:null}{captain===player.id?<b>C</b>:null}</span><strong>{player.full_name}</strong><small>{player.club}</small></button>)}</div>)}</section><section className="panel demo-bench saved-team-bench"><div className="section-row"><div><h2>Bench</h2><small>{editing?"Select one, then replace a starter above":"Your substitutes"}</small></div><span className="muted-chip">{bench.length}/7</span></div><div className="bench-scroll">{bench.map((player,index)=><button type="button" className={`saved-bench-player ${selectedBench===player.id?"selected":""}`} key={player.id} onClick={()=>onBench?.(player.id)} aria-disabled={!editing}><span>{index+1}</span><i className={`position ${player.position.toLowerCase()}`}>{player.position}</i><strong>{player.full_name}</strong><small>{player.club}</small></button>)}</div></section></>;
}
