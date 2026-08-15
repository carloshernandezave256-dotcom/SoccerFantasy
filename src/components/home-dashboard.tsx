"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BottomNav } from "./bottom-nav";
import { AccountMenu } from "./account-menu";
import { supabase } from "@/lib/supabase";

type League={league_id:string;league_name:string;invite_code:string;league_size:number;manager_count:number;team_name:string;is_commissioner:boolean;game_format:string};
type Draft={status:"waiting"|"live"|"paused"|"complete";current_pick:number;pick_deadline:string|null;pick_seconds:number};
type Manager={draft_slot:number;user_id:string;team_name:string};
type Pick={id:number;pick_number:number;user_id:string;auto_picked:boolean;players?:{full_name:string;position:"GK"|"DEF"|"MID"|"FWD";club:string}|null};
const newsPreview=[
  {tag:"BREAKING",title:"🚨 HERE WE GO! Erling Haaland to Barcelona",copy:"Agreement completed after negotiations moved quickly. Personal terms agreed and medical booked. Haaland will join Barça ahead of the new season. 🔵🔴",icon:"HWG",parody:true},
  {tag:"AVAILABILITY",title:"Injury and suspension alerts",copy:"Know when a player becomes doubtful, ruled out, or available again.",icon:"+"},
  {tag:"LINEUPS",title:"Starting-status updates",copy:"See important team-news changes before matches begin.",icon:"XI"},
  {tag:"TRANSFERS",title:"Confirmed player moves",copy:"Track transfers that affect clubs and fantasy eligibility.",icon:"↗"},
  {tag:"FORM",title:"Fantasy-relevant performances",copy:"Follow major performances and players gaining momentum.",icon:"●"},
];

function managerAtPick(order:Manager[],pickNumber:number){
  if(!order.length)return undefined;
  const round=Math.floor((pickNumber-1)/order.length)+1;
  const index=(pickNumber-1)%order.length;
  const slot=round%2?index+1:order.length-index;
  return order.find(manager=>manager.draft_slot===slot);
}

export function HomeDashboard(){
  const[leagues,setLeagues]=useState<League[]>([]);
  const[league,setLeague]=useState<League|null>(null);
  const[draft,setDraft]=useState<Draft|null>(null);
  const[order,setOrder]=useState<Manager[]>([]);
  const[picks,setPicks]=useState<Pick[]>([]);
  const[userId,setUserId]=useState<string|null>(null);
  const[name,setName]=useState("Manager");
  const[loading,setLoading]=useState(true);
  const[signedIn,setSignedIn]=useState(true);
  const[now,setNow]=useState(Date.now());
  const[parodyOpen,setParodyOpen]=useState(false);

  const load=useCallback(async()=>{
    const{data:{user}}=await supabase.auth.getUser();
    if(!user){setSignedIn(false);setLoading(false);return}
    setSignedIn(true);setUserId(user.id);
    setName(String(user.user_metadata?.display_name??user.email?.split("@")[0]??"Manager"));
    const{data:leagueData}=await supabase.rpc("my_leagues");
    const list=(leagueData??[]) as League[];setLeagues(list);
    const requested=new URLSearchParams(window.location.search).get("league");
    const active=list.find(item=>item.league_id===requested)??list[0]??null;
    setLeague(active);
    if(!active){setDraft(null);setOrder([]);setPicks([]);setLoading(false);return}
    const[draftResult,orderResult,picksResult]=await Promise.all([
      supabase.from("drafts").select("status,current_pick,pick_deadline,pick_seconds").eq("league_id",active.league_id).maybeSingle(),
      supabase.rpc("draft_order",{p_league_id:active.league_id}),
      supabase.from("draft_picks").select("id,pick_number,user_id,auto_picked,players(full_name,position,club)").eq("league_id",active.league_id).order("pick_number",{ascending:false}),
    ]);
    setDraft((draftResult.data as Draft|null)??null);
    setOrder((orderResult.data??[]) as Manager[]);
    setPicks((picksResult.data??[]) as unknown as Pick[]);
    setLoading(false);
  },[]);

  useEffect(()=>{void load();const timer=window.setInterval(()=>setNow(Date.now()),1000);return()=>window.clearInterval(timer)},[load]);
  useEffect(()=>{
    if(!league)return;
    const channel=supabase.channel(`home:${league.league_id}`)
      .on("postgres_changes",{event:"*",schema:"public",table:"drafts",filter:`league_id=eq.${league.league_id}`},()=>void load())
      .on("postgres_changes",{event:"INSERT",schema:"public",table:"draft_picks",filter:`league_id=eq.${league.league_id}`},()=>void load())
      .subscribe();
    return()=>{void supabase.removeChannel(channel)};
  },[league,load]);

  const myPicks=useMemo(()=>picks.filter(pick=>pick.user_id===userId),[picks,userId]);
  const counts=useMemo(()=>myPicks.reduce((total,pick)=>{const pos=pick.players?.position;if(pos)total[pos]++;return total},{GK:0,DEF:0,MID:0,FWD:0}),[myPicks]);
  const current=draft?managerAtPick(order,draft.current_pick):undefined;
  const isMyTurn=draft?.status==="live"&&current?.user_id===userId;
  const seconds=draft?.pick_deadline?Math.max(0,Math.ceil((new Date(draft.pick_deadline).getTime()-now)/1000)):0;
  const totalPicks=Math.max(1,order.length*18);
  const progress=draft?Math.min(100,((draft.current_pick-1)/totalPicks)*100):0;
  const nextMyPick=useMemo(()=>{if(!draft||!userId)return null;for(let pick=draft.current_pick;pick<=totalPicks;pick++)if(managerAtPick(order,pick)?.user_id===userId)return pick;return null},[draft,order,totalPicks,userId]);
  const initials=name.split(/\s+/).map(part=>part[0]).join("").slice(0,2).toUpperCase();
  const targets={GK:2,DEF:6,MID:5,FWD:5};

  return <main className="app-shell home-dashboard">
    <header className="topbar"><div><p className="eyebrow">{league?.league_name??"XI FANTASY"}</p><h1>{loading?"Loading your dashboard…":`Welcome, ${name}`}</h1></div><AccountMenu/></header>
    {leagues.length>1?<label className="home-league-switcher"><span>ACTIVE LEAGUE</span><select value={league?.league_id??""} onChange={event=>{const id=event.target.value;window.location.href=`/?league=${id}`}}>{leagues.map(item=><option key={item.league_id} value={item.league_id}>{item.league_name} · {item.game_format==="pack"?"Pack League":"Draft League"}</option>)}</select></label>:null}
    {!loading&&!signedIn?<section className="match-card home-empty"><p className="eyebrow">YOUR SEASON</p><h2>Sign in to open your dashboard.</h2><p>Your leagues, draft, roster and matchup will appear here.</p><Link className="primary-button" href="/login?next=/">Log in</Link></section>:null}
    {!loading&&signedIn&&!league?<section className="match-card home-empty"><p className="eyebrow">START HERE</p><h2>Create or join your first league.</h2><p>Once you join, this page becomes your live season command center.</p><Link className="primary-button" href="/league">Open leagues</Link></section>:null}

    {league&&draft?.status==="live"?<section className={`match-card home-draft-card ${isMyTurn?"my-turn":""}`}>
      <div className="section-row"><div><p className="eyebrow">LIVE DRAFT · PICK {draft.current_pick}</p><h2>{isMyTurn?"You’re on the clock.":`${current?.team_name??"A manager"} is picking.`}</h2></div><span className="live-pill"><span/>LIVE</span></div>
      <div className="home-clock"><strong>{String(Math.floor(seconds/60)).padStart(2,"0")}:{String(seconds%60).padStart(2,"0")}</strong><small>{isMyTurn?"Make your selection now":nextMyPick?`Your next turn: pick ${nextMyPick}`:"Draft nearly complete"}</small></div>
      <div className="progress"><span style={{width:`${progress}%`}}/></div><p className="muted">{draft.current_pick-1} of {totalPicks} picks complete</p>
      <Link className="primary-button home-primary-link" href={`/draft?league=${league.league_id}`}>{isMyTurn?"Make my pick":"Enter draft room"} →</Link>
    </section>:null}

    {league&&!draft?<section className="match-card home-draft-card"><div className="section-row"><div><p className="eyebrow">{league.game_format==="pack"?"PACK LEAGUE":"LEAGUE LOBBY"}</p><h2>{league.game_format==="pack"?"Your collection is waiting.":`${league.manager_count} managers are ready.`}</h2></div><span className="muted-chip">{league.game_format==="pack"?"PACKS":`${league.manager_count}/${league.league_size}`}</span></div><p className="home-card-copy">{league.game_format==="pack"?"Open your balanced starter bundle, choose an active squad, and build through packs, trades, and your league auction house.":"The commissioner can start the 18-round draft once at least three managers have joined."}</p><Link className="primary-button home-primary-link" href={league.game_format==="pack"?`/packs?league=${league.league_id}`:`/draft?league=${league.league_id}`}>{league.game_format==="pack"?"Open Pack club":"Open draft room"} →</Link></section>:null}
    {league&&draft?.status==="complete"?<section className="match-card home-draft-card"><p className="eyebrow">DRAFT COMPLETE</p><h2>Your squad is ready.</h2><p className="home-card-copy">Set your starting XI, arrange the bench, and choose your captain.</p><Link className="primary-button home-primary-link" href="/team">Set my lineup →</Link></section>:null}
    {league&&draft?.status==="paused"?<section className="match-card home-draft-card"><p className="eyebrow">DRAFT PAUSED</p><h2>The player pool needs attention.</h2><Link className="primary-button home-primary-link" href={`/draft?league=${league.league_id}`}>Open draft room →</Link></section>:null}

    {league?<>
      <section className="home-news" aria-labelledby="player-news-title">
        <div className="section-row"><div><p className="eyebrow">PREVIEW FEED</p><h2 id="player-news-title">Player news</h2></div><span className="muted-chip">Swipe →</span></div>
        <div className="news-scroll">{newsPreview.map(item=><article key={item.tag} className={item.parody?"breaking-parody":""} onClick={item.parody?()=>setParodyOpen(true):undefined} role={item.parody?"button":undefined} tabIndex={item.parody?0:undefined} onKeyDown={item.parody?event=>{if(event.key==="Enter"||event.key===" ")setParodyOpen(true)}:undefined}>{item.parody?<img className="breaking-news-image" src="https://raw.githubusercontent.com/carloshernandezave256-dotcom/SoccerFantasy/main/public/news/haaland-barcelona-parody.webp" alt="Parody transfer graphic of Erling Haaland wearing Barcelona colors" width={768} height={512}/>:null}<div className="news-card-top"><span className="news-icon">{item.icon}</span><b>{item.tag}</b></div><strong>{item.title}</strong><p>{item.copy}</p><small>{item.parody?"XI TRANSFER DESK · TAP FOR SOURCE":"SAMPLE · LIVE SOURCE COMING NEXT"}</small></article>)}</div>
      </section>
      <section className="quick-grid home-actions" aria-label="League shortcuts"><Link href={`/team?league=${league.league_id}`}><span className="icon">◎</span><strong>My Team</strong><small>{myPicks.length}/18 drafted</small></Link><Link href={`/players?league=${league.league_id}`}><span className="icon">⌕</span><strong>Players</strong><small>{league.game_format==="pack"?"Packs & collection":"Market & waivers"}</small></Link><Link href={`/trades?league=${league.league_id}`}><span className="icon">⇄</span><strong>Trades</strong><small>Build an offer</small></Link></section>
      <section className="panel home-roster"><div className="section-row"><div><p className="eyebrow">MY SQUAD</p><h2>{league.team_name}</h2></div><Link className="text-button" href="/team">Open team</Link></div><div className="home-position-grid">{(["GK","DEF","MID","FWD"] as const).map(pos=><div key={pos}><span>{pos}</span><strong>{counts[pos]}</strong><small>of {targets[pos]}</small></div>)}</div><div className="progress"><span style={{width:`${Math.min(100,(myPicks.length/18)*100)}%`}}/></div><p className="muted">{18-myPicks.length>0?`${18-myPicks.length} roster spots remaining`:"Full 18-player squad"}</p></section>
      <section className="panel home-activity"><div className="section-row"><div><p className="eyebrow">LEAGUE ACTIVITY</p><h2>Recent picks</h2></div><Link className="text-button" href={`/draft?league=${league.league_id}`}>Draft room</Link></div>{picks.slice(0,5).map(pick=><div className="home-pick-row" key={pick.id}><b>#{pick.pick_number}</b><span><strong>{pick.players?.full_name??"Player"}</strong><small>{order.find(manager=>manager.user_id===pick.user_id)?.team_name??"Manager"}</small></span>{pick.auto_picked?<em>AUTO</em>:null}</div>)}{picks.length===0?<p className="empty-state">Draft picks will appear here as they happen.</p>:null}</section>
    </>:null}
    {parodyOpen?<div className="news-reveal-overlay" role="dialog" aria-modal="true" aria-label="Transfer story source"><section className="news-reveal-card"><span>😂</span><p className="eyebrow">XI PARODY · BETA TEST</p><h2>Not quite “here we go.”</h2><p>Haaland to Barcelona was planted in the beta feed to test whether your league mates are paying attention. No real reporter published this story.</p><button className="primary-button" onClick={()=>setParodyOpen(false)}>You got me</button></section></div>:null}
    <BottomNav/>
  </main>;
}
