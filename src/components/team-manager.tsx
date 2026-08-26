"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { PageShell } from "./page-shell";
import { supabase } from "@/lib/supabase";
import { resolveActiveLeague } from "@/lib/active-league";
import { PlayerStatsDialog } from "./player-stats-dialog";
import { getPackHeroCard } from "@/lib/pack-hero-cards";
import { formationIsValid, lineupIsReady, reorderWithinPosition } from "@/lib/lineup";
import { loginPathFor } from "@/lib/auth-navigation";

type League={league_id:string;league_name:string;team_name:string;game_format:string};
type Player={id:number;full_name:string;position:string;club:string;competition?:string;photo_url?:string|null;injured?:boolean;injury_type?:string|null;injury_reason?:string|null;expected_return?:string|null};
type Manager={draft_slot:number;user_id:string;team_name:string};
type LineupRow={player_id:number;is_starter:boolean;is_captain:boolean;bench_order:number|null;pitch_order:number|null};
type LineupLock={gameweek:number;locks_at:string;reopens_after:string|null;locked:boolean};

function centerHaaland(order:number[],roster:Player[]){
  const forwards=order.filter(id=>roster.find(player=>player.id===id)?.position==="FWD");
  const haaland=forwards.find(id=>roster.find(player=>player.id===id)?.full_name==="Erling Haaland");
  if(!haaland||forwards.length<3)return order;
  const middle=forwards[Math.floor(forwards.length/2)];
  return order.map(id=>id===haaland?middle:id===middle?haaland:id);
}

function defaultStartingEleven(roster:Player[]){
  const available=roster.filter(player=>!player.injured);
  const chosen:Player[]=[];
  const add=(players:Player[],limit:number)=>players.slice(0,limit).forEach(player=>{if(!chosen.some(item=>item.id===player.id))chosen.push(player)});
  add(available.filter(player=>player.position==="GK"),1);
  add(available.filter(player=>player.position==="DEF"),4);
  add(available.filter(player=>player.position==="MID"),3);
  add(available.filter(player=>player.position==="FWD"),3);
  add(available.filter(player=>player.position!=="GK"&&!chosen.some(item=>item.id===player.id)),11-chosen.length);
  return new Set(chosen.map(player=>player.id));
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
  const[arrangeMode,setArrangeMode]=useState(false);
  const[selectedStarter,setSelectedStarter]=useState<number|null>(null);
  const[editing,setEditing]=useState(false);
  const[dirty,setDirty]=useState(false);
  const[undoOrder,setUndoOrder]=useState<number[]|null>(null);
  const[message,setMessage]=useState("");
  const[loading,setLoading]=useState(true);
  const[infoPlayer,setInfoPlayer]=useState<Player|null>(null);
  const[lineupLock,setLineupLock]=useState<LineupLock|null>(null);
  const suppressRefreshUntil=useRef(0);
  const dirtyRef=useRef(false);
  const savedStarterIdsRef=useRef<Set<number>>(new Set());
  const loadedRosterKeyRef=useRef("");
  const rosterRequestRef=useRef(0);

  const loadRoster=useCallback(async(id:string,ownerId:string)=>{
    const requestId=++rosterRequestRef.current;
    const rosterKey=`${id}:${ownerId}`;
    const switchingRoster=loadedRosterKeyRef.current!==rosterKey;
    if(switchingRoster){setLoading(true);setMessage("");setRoster([]);setStarters(new Set());setStarterOrder([]);setCaptain(null);setInfoPlayer(null);setUndoOrder(null);setSelectedStarter(null)}
    const[{data:draftPicks},{data:packCards},{data:lineup},{data:lockRows}]=await Promise.all([
      supabase.from("draft_picks").select("player_id,players(id,full_name,position,club,competition,photo_url,injured,injury_type,injury_reason,expected_return)").eq("league_id",id).eq("user_id",ownerId),
      supabase.from("pack_cards").select("player_id,active_slot,players(id,full_name,position,club,competition,photo_url,injured,injury_type,injury_reason,expected_return)").eq("league_id",id).eq("user_id",ownerId).not("active_slot","is",null).order("active_slot"),
      supabase.from("lineup_players").select("player_id,is_starter,is_captain,bench_order,pitch_order").eq("league_id",id).eq("user_id",ownerId),
      supabase.rpc("lineup_lock_state",{p_league_id:id}),
    ]);
    if(requestId!==rosterRequestRef.current)return;
    const currentLock=((lockRows??[]) as LineupLock[])[0]??null;
    setLineupLock(currentLock);
    let saved=(lineup??[]) as LineupRow[];
    const loadedRoster=[...(draftPicks??[]),...(packCards??[])].flatMap(row=>row.players?[row.players as unknown as Player]:[]);
    let savedStarterIds=new Set(saved.filter(row=>row.is_starter).map(row=>row.player_id));
    let savedLineupIsValid=formationIsValid(loadedRoster,savedStarterIds);
    if(!currentLock?.locked&&!savedLineupIsValid&&loadedRoster.length>=11){
      const{data:{user}}=await supabase.auth.getUser();
      if(user?.id===ownerId){
        const defaults=defaultStartingEleven(loadedRoster);
        const defaultOrder=centerHaaland(loadedRoster.filter(player=>defaults.has(player.id)).map(player=>player.id),loadedRoster);
        const defaultBench=loadedRoster.filter(player=>!defaults.has(player.id)).slice(0,7).map(player=>player.id);
        const{data:initialized,error}=defaultOrder.length===11
          ? await supabase.rpc("initialize_default_lineup",{p_league_id:id,p_starters:defaultOrder,p_bench:defaultBench})
          : {data:false,error:null};
        if(requestId!==rosterRequestRef.current)return;
        if(error)setMessage(error.message);
        else if(initialized){
          saved=[...defaultOrder.map((player_id,index)=>({player_id,is_starter:true,is_captain:false,bench_order:null,pitch_order:index+1})),...defaultBench.map((player_id,index)=>({player_id,is_starter:false,is_captain:false,bench_order:index+1,pitch_order:null}))];
          savedStarterIds=new Set(defaultOrder);savedLineupIsValid=true;
        }
      }
    }
    setRoster(loadedRoster);
    const starterIds=savedLineupIsValid?savedStarterIds:defaultStartingEleven(loadedRoster);
    const savedOrder=saved.filter(row=>row.is_starter).sort((a,b)=>(a.pitch_order??999)-(b.pitch_order??999)).map(row=>row.player_id);
    const fallbackOrder=loadedRoster.filter(player=>starterIds.has(player.id)).map(player=>player.id);
    setStarters(starterIds);
    const orderedSaved=savedOrder.filter(id=>starterIds.has(id));
    const mergedOrder=[...orderedSaved,...fallbackOrder.filter(id=>!orderedSaved.includes(id))];
    setStarterOrder(saved.some(row=>row.is_starter&&row.pitch_order!==null)?mergedOrder:centerHaaland(fallbackOrder,loadedRoster));
    const savedCaptain=saved.find(row=>row.is_captain)?.player_id??null;
    savedStarterIdsRef.current=new Set(savedStarterIds);
    setCaptain(savedLineupIsValid&&savedCaptain!==null&&starterIds.has(savedCaptain)?savedCaptain:null);
    loadedRosterKeyRef.current=rosterKey;
    if(switchingRoster){setEditing(!currentLock?.locked&&(!savedLineupIsValid||savedCaptain===null));setDirty(false);setArrangeMode(false);setSelectedStarter(null)}
    setLoading(false);
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
      if(!user){window.location.replace(loginPathFor(window.location.pathname,window.location.search));return}
      setUserId(user.id);
      const{data}=await supabase.rpc("my_leagues");
      const list=(data??[]) as League[];
      setLeagues(list);
      const active=resolveActiveLeague(list,new URLSearchParams(window.location.search).get("league"));
      if(active){setLeague(active.league_id);const{data:order}=await supabase.rpc("draft_order",{p_league_id:active.league_id});const managersList=(order??[]) as Manager[];setManagers(managersList);const owner=managersList.some(manager=>manager.user_id===user.id)?user.id:managersList[0]?.user_id??"";setViewedUser(owner);if(owner)await loadRoster(active.league_id,owner)}
      else setLoading(false);
  },[loadRoster]);

  useEffect(()=>{dirtyRef.current=dirty},[dirty]);

  useEffect(()=>{
    void loadActiveLeague();
    const refresh=()=>{if(!dirtyRef.current&&Date.now()>=suppressRefreshUntil.current)void loadActiveLeague()};
    window.addEventListener("pageshow",refresh);
    window.addEventListener("popstate",refresh);
    return()=>{window.removeEventListener("pageshow",refresh);window.removeEventListener("popstate",refresh)};
  },[loadActiveLeague]);

  useEffect(()=>{
    if(!league||!viewedUser)return;
    const refresh=()=>{if(!dirtyRef.current&&Date.now()>=suppressRefreshUntil.current)void loadRoster(league,viewedUser)};
    const channel=supabase.channel(`my-team-${league}-${viewedUser}`)
      .on("postgres_changes",{event:"*",schema:"public",table:"lineup_players",filter:`league_id=eq.${league}`},refresh)
      .on("postgres_changes",{event:"*",schema:"public",table:"draft_picks",filter:`league_id=eq.${league}`},refresh)
      .on("postgres_changes",{event:"*",schema:"public",table:"pack_cards",filter:`league_id=eq.${league}`},refresh)
      .subscribe();
    const visible=()=>{if(document.visibilityState==="visible")refresh()};
    document.addEventListener("visibilitychange",visible);
    return()=>{document.removeEventListener("visibilitychange",visible);void supabase.removeChannel(channel)};
  },[league,loadRoster,viewedUser]);

  useEffect(()=>{const warn=(event:BeforeUnloadEvent)=>{if(dirty){event.preventDefault();event.returnValue=""}};window.addEventListener("beforeunload",warn);return()=>window.removeEventListener("beforeunload",warn)},[dirty]);

  const isMine=viewedUser===userId;
  const lineupLocked=Boolean(lineupLock?.locked);
  const viewedManager=managers.find(manager=>manager.user_id===viewedUser);
  const showPackCards=leagues.find(item=>item.league_id===league)?.game_format==="pack";
  const counts=useMemo(()=>roster.filter(player=>starters.has(player.id)).reduce((all,player)=>({...all,[player.position]:(all[player.position]??0)+1}),{} as Record<string,number>),[roster,starters]);
  const unavailableStarters=useMemo(()=>roster.filter(player=>starters.has(player.id)&&player.injured),[roster,starters]);
  const valid=lineupIsReady(roster,starters,captain)&&unavailableStarters.length===0;
  const captainPlayer=roster.find(player=>player.id===captain)??null;
  const selectedStarterPlayer=roster.find(player=>player.id===selectedStarter)??null;
  const compatibleBenchIds=useMemo(()=>{
    if(selectedStarter===null)return new Set<number>();
    return new Set(roster.filter(player=>!starters.has(player.id)&&!player.injured).filter(player=>{
      const next=new Set(starters);next.delete(selectedStarter);next.add(player.id);return formationIsValid(roster,next);
    }).map(player=>player.id));
  },[roster,selectedStarter,starters]);
  const lineupStatus=lineupLocked?"LOCKED":valid?"READY":"ACTION NEEDED";
  const lineupStatusTone=lineupLocked?"locked":valid?"ready":"attention";
  const lineupDeadline=lineupLock
    ? lineupLocked
      ? lineupLock.reopens_after
        ? `Reopens ${new Date(lineupLock.reopens_after).toLocaleString([], {weekday:"short",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})}`
        : "Reopens after every gameweek fixture is final"
      : `Locks ${new Date(lineupLock.locks_at).toLocaleString([], {weekday:"short",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})}`
    : "Lineup deadline will appear when the gameweek schedule is ready";

  function tapStarter(id:number){
    if(!isMine||!editing||lineupLocked)return;
    if(arrangeMode){
      if(selectedStarter===null){setSelectedStarter(id);setMessage(`${roster.find(player=>player.id===id)?.full_name} selected. Tap another ${roster.find(player=>player.id===id)?.position} to rearrange the row.`);return}
      if(selectedStarter===id){setSelectedStarter(null);setMessage("Pitch arrangement selection cleared.");return}
      const selectedPosition=roster.find(player=>player.id===selectedStarter)?.position;
      const targetPosition=roster.find(player=>player.id===id)?.position;
      if(!selectedPosition||selectedPosition!==targetPosition){setMessage(`Choose another ${selectedPosition??"player in the same position row"}. Players cannot move into a different position row.`);return}
      reorderStarter(selectedStarter,id);setSelectedStarter(null);return;
    }
    if(selectedStarter===id){setSelectedStarter(null);setMessage("Starter selection cleared.");return}
    setSelectedStarter(id);
    setMessage(`${roster.find(player=>player.id===id)?.full_name} selected. Choose an eligible replacement from the bench.`);
  }

  function replaceStarterWithBench(benchId:number){
    if(!isMine||!editing||lineupLocked)return;
    if(selectedStarter===null){setMessage("Start by tapping the player on the pitch you want to replace.");return}
    const incoming=roster.find(player=>player.id===benchId);
    const outgoing=roster.find(player=>player.id===selectedStarter);
    if(incoming?.injured){setMessage(`${incoming.full_name} is currently injured, suspended, or unavailable and cannot enter the Starting XI.`);return}
    const next=new Set(starters);next.delete(selectedStarter);next.add(benchId);
    if(!formationIsValid(roster,next)){setMessage("That switch would create an invalid formation. Keep 1 GK, at least 3 DEF, and no more than 4 FWD.");return}
    setStarters(next);
    setStarterOrder(order=>order.map(playerId=>playerId===selectedStarter?benchId:playerId));
    setDirty(true);
    if(captain===selectedStarter)setCaptain(null);
    setSelectedStarter(null);
    setMessage(`${incoming?.full_name} moved into the XI; ${outgoing?.full_name} moved to the bench.`);
  }

  function reorderStarter(id:number,targetId:number){
    if(lineupLocked){setMessage("Your full lineup is locked until every fixture in this gameweek is final.");return}
    const previous=[...starterOrder],next=reorderWithinPosition(roster,previous,id,targetId);
    if(!next)return;
    setStarterOrder(next);setUndoOrder(previous);setDirty(true);
    if(isMine)void persistOrder(next,previous);
  }

  async function persistOrder(order:number[],rollback:number[]){
    const matchesSavedXI=starters.size===savedStarterIdsRef.current.size&&[...starters].every(id=>savedStarterIdsRef.current.has(id));
    if(!matchesSavedXI){setMessage("Arrangement ready. Finish lineup to save your updated XI and positions together.");return}
    suppressRefreshUntil.current=Date.now()+4000;
    const start=[...order.filter(id=>starters.has(id)),...[...starters].filter(id=>!order.includes(id))];
    const{error}=await supabase.rpc(starters.size<11?"save_partial_pitch_order":"save_pitch_order",starters.size<11?{p_league_id:league,p_players:start}:{p_league_id:league,p_starters:start});
    if(error){setStarterOrder(rollback);setUndoOrder(null);setDirty(false);setMessage(error.message)}
    else{setDirty(false);setMessage("Player positions saved automatically.")}
  }

  async function persistCaptain(nextCaptain:number,rollback:number|null){
    if(roster.find(player=>player.id===nextCaptain)?.injured){setCaptain(rollback);setDirty(false);setMessage("Unavailable players cannot be selected as Captain.");return}
    suppressRefreshUntil.current=Date.now()+4000;
    const{error}=await supabase.rpc("set_lineup_captain",{p_league_id:league,p_captain:nextCaptain});
    if(error){setCaptain(rollback);setDirty(false);setMessage(error.message)}
    else{setDirty(false);setMessage(`${roster.find(player=>player.id===nextCaptain)?.full_name} is saved as your Captain.`)}
  }

  function resetTo433(){
    const next=defaultStartingEleven(roster),order=centerHaaland(roster.filter(player=>next.has(player.id)).map(player=>player.id),roster);
    if(next.size!==11||!formationIsValid(roster,next)){setMessage("A valid 4-3-3 cannot be created while your squad has too few available players. Replace unavailable players manually when possible.");return}
    setStarters(next);setStarterOrder(order);if(captain!==null&&!next.has(captain))setCaptain(null);setEditing(true);setSelectedStarter(null);setArrangeMode(false);setDirty(true);setMessage("Reset to the default 4-3-3. Save to keep this lineup.");
  }

  async function undoChanges(){
    if(!league||!viewedUser)return;
    if(undoOrder&&isMine&&captain!==null){const current=[...starterOrder];setStarterOrder(undoOrder);await persistOrder(undoOrder,current);setUndoOrder(null);setMessage("Last player move undone and saved.");return}
    await loadRoster(league,viewedUser);setMessage("Unsaved lineup changes were undone.");
  }

  async function save(){
    if(lineupLocked){setMessage("Your full lineup is locked until every fixture in this gameweek is final.");return}
    if(!isMine||!valid||captain===null){setMessage("Choose a valid starting XI and Captain before saving.");return}
    suppressRefreshUntil.current=Date.now()+4000;
    const start=[...starterOrder.filter(id=>starters.has(id)),...[...starters].filter(id=>!starterOrder.includes(id))];
    const bench=roster.filter(player=>!starters.has(player.id)).slice(0,7).map(player=>player.id);
    const{error}=await supabase.rpc("save_lineup",{p_league_id:league,p_starters:start,p_bench:bench,p_captain:captain});
    if(error)setMessage(error.message);else{savedStarterIdsRef.current=new Set(start);setMessage("Lineup and Captain saved.");setDirty(false);setUndoOrder(null);setEditing(false);setArrangeMode(false);setSelectedStarter(null)}
  }

  return <PageShell leagueId={league} eyebrow={viewedManager?.team_name??leagues.find(item=>item.league_id===league)?.team_name??"MY CLUB"} title={isMine?"My Team":"Team Viewer"}>
    <div className="team-selectors">
      <label>View team<select className="league-select" value={viewedUser} onChange={event=>{setViewedUser(event.target.value);void loadRoster(league,event.target.value)}}>{managers.map(manager=><option key={manager.user_id} value={manager.user_id}>{manager.user_id===userId?"My Team":manager.team_name}</option>)}</select></label>
    </div>

    {loading?<section className="panel empty-state">Loading squad…</section>:roster.length===0?(showPackCards&&isMine?<section className="panel empty-state"><strong>Your pack squad is waiting.</strong><p>Open your starter bundle first. Every packed player will save to this league, and the first 18 unique cards will refresh into My Team automatically.</p><Link className="primary-button full-button" href={`/packs?league=${league}`}>Open starter bundle</Link></section>:isMine?<section className="panel empty-state"><strong>Waiting for this league&apos;s draft.</strong><p>Your players will appear here as this league drafts. No roster from another league will be shown.</p></section>:<section className="panel empty-state"><strong>{viewedManager?.team_name} has no players yet.</strong><p>{showPackCards?"Their packed players will appear here after they open a starter bundle.":"Their drafted squad will appear here as picks are made."}</p></section>):<>
      <section className="formation-card team-lineup-overview">
        <div className="team-overview-heading">
          <div>
            <small>{isMine?"WEEKLY LINEUP":viewedManager?.team_name?.toUpperCase()}</small>
            <strong>{starters.size===11?`${counts.DEF??0}-${counts.MID??0}-${counts.FWD??0}`:`${starters.size}/11 selected`}</strong>
          </div>
          <span className={`team-lineup-status ${lineupStatusTone}`}>{lineupStatus}</span>
        </div>
        <div className="team-overview-details">
          <div><small>GAMEWEEK</small><strong>{lineupLock?.gameweek??"—"}</strong></div>
          <div><small>CAPTAIN</small><strong>{captainPlayer?.full_name??"Needed"}</strong></div>
          <div><small>SQUAD</small><strong>{starters.size}/11 · {roster.length-starters.size}/7</strong></div>
        </div>
        {isMine?<p className="team-lineup-deadline">{lineupDeadline}</p>:null}
        <div className="formation-counts" aria-label="Formation requirements">
          <span className={(counts.GK??0)===1?"complete":"needed"}>GK {counts.GK??0}/1</span>
          <span className={(counts.DEF??0)>=3?"complete":"needed"}>DEF {counts.DEF??0}/3+</span>
          <span className={(counts.MID??0)>=1?"complete":"needed"}>MID {counts.MID??0}/1+</span>
          <span className={(counts.FWD??0)>=1&&(counts.FWD??0)<=4?"complete":"needed"}>FWD {counts.FWD??0}/1–4</span>
        </div>
      </section>
      {isMine&&lineupLocked?<section className="panel lineup-lock-banner"><strong>Gameweek {lineupLock?.gameweek} lineup locked</strong><p>Your starting XI, bench order, player arrangement, and Captain reopen together after every fixture in this gameweek is final.</p></section>:null}
      {isMine&&editing&&unavailableStarters.length?<section className="panel lineup-availability-alert"><strong>Replace unavailable starters</strong><p>{unavailableStarters.map(player=>player.full_name).join(", ")} cannot be saved in the Starting XI. Select an available bench player, then replace the starter.</p></section>:null}
      {isMine&&editing?<><section className="lineup-save-dock"><span className={dirty?"dirty":valid?"ready":"attention"}><b>{dirty?"UNSAVED CHANGES":valid?"LINEUP READY":"ACTION NEEDED"}</b><small>{captain===null?"Choose a Captain to finish":dirty?"Save your changes":"Your XI and Captain are complete"}</small></span><button type="button" className="primary-button" disabled={!valid} onClick={save}>{captain===null?"Choose Captain":"Save lineup"}</button></section><section className="team-captain-control"><div><small>CAPTAIN</small><strong>{captainPlayer?.full_name??"Choose your Captain"}</strong><p>Captain earns +50% fantasy points.</p></div><select className="league-select captain-select" aria-label="Choose Captain" value={captain??""} onChange={event=>{const next=Number(event.target.value);if(!next)return;const previous=captain;setCaptain(next);setSelectedStarter(null);setDirty(true);void persistCaptain(next,previous)}}><option value="">Choose Captain</option>{starterOrder.filter(id=>starters.has(id)).flatMap(id=>{const player=roster.find(item=>item.id===id);return player?[<option key={player.id} value={player.id}>{player.full_name}</option>]:[]})}</select></section>{message?<p className="team-instruction">{message}</p>:null}<SavedTeamPitch roster={roster} starters={starters} starterOrder={starterOrder} captain={captain} showPackCards={showPackCards} editing allowDrag={false} selectedStarter={selectedStarter} compatibleBenchIds={compatibleBenchIds} onInfo={id=>setInfoPlayer(roster.find(player=>player.id===id)??null)} onStarter={tapStarter} onReorder={(id,targetId)=>{setSelectedStarter(null);reorderStarter(id,targetId)}} onBench={replaceStarterWithBench}/><div className="lineup-edit-actions"><button type="button" className={`secondary-button ${arrangeMode?"active":""}`} onClick={()=>{setArrangeMode(active=>!active);setSelectedStarter(null);setMessage(arrangeMode?"Tap a starter, then choose a bench replacement.":"Select two players in the same position row to swap them.")}}>{arrangeMode?"Finish reordering":"Reorder players"}</button><button type="button" className="secondary-button" onClick={resetTo433}>Reset 4-3-3</button><button type="button" className="secondary-button" disabled={!dirty&&!undoOrder} onClick={()=>void undoChanges()}>Undo</button></div></>:<><SavedTeamPitch roster={roster} starters={starters} starterOrder={starterOrder} captain={captain} showPackCards={showPackCards} onInfo={id=>setInfoPlayer(roster.find(player=>player.id===id)??null)} onBench={id=>setInfoPlayer(roster.find(player=>player.id===id)??null)}/>{isMine?<button className="primary-button full-button edit-lineup-button" disabled={lineupLocked} onClick={()=>{setEditing(true);setArrangeMode(false);setSelectedStarter(null);setMessage("Tap a starter first, then choose an eligible replacement from the bench.")}}>{lineupLocked?"Lineup locked":valid?"Edit lineup":"Complete lineup"}</button>:<div className="view-only-banner">Viewing {viewedManager?.team_name} · Read only</div>}</>}
    </>}
    {message&&isMine?<p className="form-message">{message}</p>:null}
    {infoPlayer?<PlayerStatsDialog leagueId={league} player={infoPlayer} onClose={()=>setInfoPlayer(null)}/>:null}
  </PageShell>;
}

function SavedTeamPitch({roster,starters,starterOrder,captain,editing=false,allowDrag=editing,selectedStarter=null,compatibleBenchIds=new Set<number>(),onStarter,onBench,onReorder,onInfo,showPackCards=false}:{roster:Player[];starters:Set<number>;starterOrder:number[];captain:number|null;editing?:boolean;allowDrag?:boolean;selectedStarter?:number|null;compatibleBenchIds?:Set<number>;onStarter?:(id:number)=>void;onBench?:(id:number)=>void;onReorder?:(id:number,targetId:number)=>void;onInfo?:(id:number)=>void;showPackCards?:boolean}){
  const[pitchDrag,setPitchDrag]=useState<{id:number;targetId:number;position:string;top:number;left:number;width:number;height:number;offsetX:number;offsetY:number;moved:boolean}|null>(null);
  const pitchDragRef=useRef<typeof pitchDrag>(null);
  const selected=[...starterOrder.filter(id=>starters.has(id)),...[...starters].filter(id=>!starterOrder.includes(id))].flatMap(id=>{const player=roster.find(item=>item.id===id);return player?[player]:[]});
  const positionRank:Record<string,number>={GK:0,DEF:1,MID:2,FWD:3};
  const bench=roster.filter(player=>!starters.has(player.id)).sort((a,b)=>(positionRank[a.position]??9)-(positionRank[b.position]??9)||a.full_name.localeCompare(b.full_name));
  const groups={FWD:selected.filter(player=>player.position==="FWD"),MID:selected.filter(player=>player.position==="MID"),DEF:selected.filter(player=>player.position==="DEF"),GK:selected.filter(player=>player.position==="GK")};
  function beginPitchDrag(event:React.PointerEvent<HTMLButtonElement>,player:Player){
    const slot=event.currentTarget.closest<HTMLElement>(".pitch-player-slot");if(!slot)return;
    const rect=event.currentTarget.getBoundingClientRect();event.currentTarget.setPointerCapture(event.pointerId);
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
    if(active.moved&&active.targetId!==active.id)onReorder?.(active.id,active.targetId);else if(!active.moved){if(editing)onStarter?.(active.id);else onInfo?.(active.id)}
  }
  const draggedPlayer=pitchDrag?roster.find(player=>player.id===pitchDrag.id):null;
  return <><section className={`mini-pitch saved-team-pitch ${pitchDrag?.moved?"is-reordering":""}`} aria-label="Starting eleven mini pitch"><div className="pitch-box top-box"/><div className="center-line"/><div className="center-circle"/><div className="pitch-box bottom-box"/>{(["FWD","MID","DEF","GK"] as const).map(position=><div className={`pitch-row row-${position.toLowerCase()}`} style={{gridTemplateColumns:`repeat(${Math.max(groups[position].length,1)}, minmax(0, 1fr))`}} key={position}>{groups[position].map(player=><PitchPlayer key={player.id} player={player} editing={editing} captain={captain} selectedStarter={selectedStarter} showPackCards={showPackCards} pitchDrag={pitchDrag} onPointerDown={beginPitchDrag} onPointerMove={updatePitchDrag} onPointerUp={finishPitchDrag}/>)}</div>)}</section>{pitchDrag?.moved&&draggedPlayer?<PitchDragGhost player={draggedPlayer} drag={pitchDrag} showPackCards={showPackCards}/>:null}<section className="panel demo-bench saved-team-bench"><div className="section-row"><div><h2>Bench</h2><small>{editing?(selectedStarter!==null?"Choose a highlighted replacement":"Tap a starter on the pitch first"):"Your substitutes"}</small></div><span className="muted-chip">{bench.length}/7</span></div><div className="bench-scroll">{bench.map((player,index)=>{const choosing=editing&&selectedStarter!==null,eligible=compatibleBenchIds.has(player.id);return <button type="button" className={`saved-bench-player ${choosing&&eligible?"eligible":""} ${choosing&&!eligible?"ineligible":""}`} key={player.id} onClick={()=>onBench?.(player.id)} disabled={choosing&&!eligible} aria-disabled={!editing||choosing&&!eligible}><span>{index+1}</span><span className="bench-player-face">{player.photo_url?<img className="api-headshot" src={player.photo_url} alt="" onError={event=>{event.currentTarget.style.display="none";event.currentTarget.parentElement?.classList.add("headshot-missing")}}/>:null}<i className={`position ${player.position.toLowerCase()}`}>{player.position}</i>{player.injured?<b className="injury-cross" title={player.injury_reason??player.injury_type??"Unavailable"}>✚</b>:null}</span><strong>{player.full_name}</strong><small>{choosing&&eligible?"Tap to bring in":player.club}</small></button>})}</div></section></>;
}

type PitchDrag={id:number;targetId:number;position:string;top:number;left:number;width:number;height:number;offsetX:number;offsetY:number;moved:boolean};

function PitchPlayer({player,editing,captain,selectedStarter,showPackCards,pitchDrag,onPointerDown,onPointerMove,onPointerUp}:{player:Player;editing:boolean;captain:number|null;selectedStarter:number|null;showPackCards:boolean;pitchDrag:PitchDrag|null;onPointerDown:(event:React.PointerEvent<HTMLButtonElement>,player:Player)=>void;onPointerMove:(event:React.PointerEvent<HTMLButtonElement>)=>void;onPointerUp:(event:React.PointerEvent<HTMLButtonElement>)=>void}){
 const hero=showPackCards?getPackHeroCard(player.full_name):null;
 return <div className={`pitch-player-slot ${selectedStarter===player.id?"pitch-tap-selected":""} ${pitchDrag?.moved&&pitchDrag.id===player.id?"pitch-drag-source":""} ${pitchDrag?.moved&&pitchDrag.targetId===player.id&&pitchDrag.id!==player.id?"pitch-drop-target":""}`} data-position={player.position} data-player-id={player.id}><button type="button" className="saved-pitch-player" onPointerDown={event=>onPointerDown(event,player)} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onClick={event=>event.preventDefault()} aria-disabled={!editing}><span className={`shirt shirt-${player.position.toLowerCase()} ${hero?"mini-card-shirt":""}`}>{hero?<img src={hero.src} alt=""/>:player.photo_url?<img className="api-headshot" src={player.photo_url} alt="" onError={event=>{event.currentTarget.style.display="none"}}/>:null}{player.injured?<span className="injury-cross" title={player.injury_reason??player.injury_type??"Unavailable"}>✚</span>:null}{captain===player.id?<b title="Captain: +50% fantasy points" aria-label="Captain">★</b>:null}</span><strong>{player.full_name}</strong><small>{player.club}</small></button></div>
}

function PitchDragGhost({player,drag,showPackCards}:{player:Player;drag:PitchDrag;showPackCards:boolean}){
 const hero=showPackCards?getPackHeroCard(player.full_name):null;
 return <div className="pitch-drag-ghost" aria-hidden="true" style={{top:drag.top,left:drag.left,width:drag.width,height:drag.height}}><span className={`shirt shirt-${player.position.toLowerCase()} ${hero?"mini-card-shirt":""}`}>{hero?<img src={hero.src} alt=""/>:player.photo_url?<img className="api-headshot" src={player.photo_url} alt="" onError={event=>{event.currentTarget.style.display="none"}}/>:null}{player.injured?<span className="injury-cross">✚</span>:null}</span><strong>{player.full_name}</strong><small>{player.position} row</small></div>
}
