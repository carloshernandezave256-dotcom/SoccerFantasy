"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageShell } from "./page-shell";
import { supabase } from "@/lib/supabase";
import { type LedgerEntry } from "@/lib/scoring";
import { resolveActiveLeague } from "@/lib/active-league";
import { PlayerHeadshot } from "./player-headshot";

type League={league_id:string;league_name:string;team_name:string;game_format:string};
type Manager={draft_slot:number;user_id:string;team_name:string};
type Matchup={id:string;gameweek:number;home_user_id:string;away_user_id:string;home_score:number|string;away_score:number|string;status:"scheduled"|"live"|"final"};
type Player={id:number;full_name:string;position:string;club:string;photo_url?:string|null;captain?:boolean;score:number;rating:number|null;status:"not_started"|"live"|"final";ledger:LedgerEntry[];goals:number;assists:number;yellowCards:number;redCards:number};
type TeamView={userId:string;name:string;score:number;players:Player[];lineupSet:boolean};
type ScoreRow={player_id:number;rating:number|null;minutes:number;goals:number;assists:number;shots_on_target:number;big_chances_missed:number;completed_passes:number;tackles_won:number;penalty_goals:number;penalties_missed:number;penalties_conceded:number;saves:number;penalties_saved:number;goals_conceded:number;yellow_cards:number;second_yellow_cards:number;red_cards:number;own_goals:number;status:"not_started"|"live"|"final";fantasy_points:number|string;score_ledger:LedgerEntry[]};
type Standing={rank:number;user_id:string;team_name:string;played:number;wins:number;draws:number;losses:number;points:number;fantasy_points:number|string};

const positionOrder:Record<string,number>={GK:0,DEF:1,MID:2,FWD:3};
const homePitchRows=["GK","DEF","MID","FWD"] as const;
const awayPitchRows=["FWD","MID","DEF","GK"] as const;

function EventBadges({player}:{player:Player}){
  return <span className="pitch-events">
    {player.goals>0?<span className="pitch-event goal" title={`${player.goals} ${player.goals===1?"goal":"goals"}`} aria-label={`${player.goals} ${player.goals===1?"goal":"goals"}`}>⚽{player.goals>1?<b>{player.goals}</b>:null}</span>:null}
    {player.assists>0?<span className="pitch-event assist" title={`${player.assists} ${player.assists===1?"assist":"assists"}`} aria-label={`${player.assists} ${player.assists===1?"assist":"assists"}`}>A{player.assists>1?<b>{player.assists}</b>:null}</span>:null}
    {player.yellowCards>0?<span className="pitch-event card yellow" title={`${player.yellowCards} yellow card`} aria-label={`${player.yellowCards} yellow card`}>{player.yellowCards>1?<b>{player.yellowCards}</b>:null}</span>:null}
    {player.redCards>0?<span className="pitch-event card red" title="Red card" aria-label="Red card"/>:null}
    {player.captain?<span className="pitch-event captain" title="Captain: +50% fantasy points" aria-label="Captain">★</span>:null}
  </span>;
}

function PitchPlayer({player,onSelect}:{player:Player;onSelect:(player:Player)=>void}){
  const words=player.full_name.trim().split(/\s+/);
  const displayName=player.full_name.length>13&&words.length>1?`${words[0][0]}. ${words.slice(1).join(" ")}`:player.full_name;
  return <button className="pitch-player" onClick={()=>onSelect(player)} aria-label={`Open ${player.full_name} scoring breakdown`}>
    <span className="pitch-player-photo"><PlayerHeadshot name={player.full_name} position={player.position} photoUrl={player.photo_url}/><b className={player.score<0?"negative":"positive"}>{player.score}</b><EventBadges player={player}/></span>
    <strong title={player.full_name}>{displayName}</strong>
    <small>{player.position}</small>
  </button>;
}

export function RealMatchup(){
  const[league,setLeague]=useState<League|null>(null);
  const[userId,setUserId]=useState<string|null>(null);
  const[managers,setManagers]=useState<Manager[]>([]);
  const[matchups,setMatchups]=useState<Matchup[]>([]);
  const[gameweek,setGameweek]=useState(1);
  const[teams,setTeams]=useState<TeamView[]>([]);
  const[standings,setStandings]=useState<Standing[]>([]);
  const[selected,setSelected]=useState<Player|null>(null);
  const[loading,setLoading]=useState(true);
  const[message,setMessage]=useState("");
  const[refreshing,setRefreshing]=useState(false);
  const[lastUpdated,setLastUpdated]=useState<Date|null>(null);
  const[now,setNow]=useState(()=>Date.now());
  const[lineupVersion,setLineupVersion]=useState(0);
  const[selectedMatchupId,setSelectedMatchupId]=useState<string|null>(null);
  const refreshRequest=useRef(0);

  const load=useCallback(async()=>{
    setLoading(true);setMessage("");
    const{data:{user}}=await supabase.auth.getUser();
    if(!user){setMessage("Log in to open your league matchup.");setLoading(false);return}
    setUserId(user.id);
    const{data:leagueData}=await supabase.rpc("my_leagues");
    const leagues=(leagueData??[]) as League[];
    const active=resolveActiveLeague(leagues,new URLSearchParams(window.location.search).get("league"))??null;
    setLeague(active);
    if(!active){setMessage("Create or join a league to generate your schedule.");setLoading(false);return}
    if(active.game_format==="draft"){
      const{data:draft}=await supabase.from("drafts").select("status").eq("league_id",active.league_id).maybeSingle();
      if(draft?.status!=="complete"){
        setMessage("Your randomized matchups will generate when the draft is complete.");
        setLoading(false);
        return;
      }
    }
    const{error:scheduleError}=await supabase.rpc("ensure_league_schedule",{p_league_id:active.league_id});
    if(scheduleError){setMessage(scheduleError.message);setLoading(false);return}
    const[orderResult,matchupResult,scoreWeekResult,windowResult]=await Promise.all([
      supabase.rpc("draft_order",{p_league_id:active.league_id}),
      supabase.from("league_matchups").select("id,gameweek,home_user_id,away_user_id,home_score,away_score,status").eq("league_id",active.league_id).order("gameweek"),
      supabase.from("league_player_scores").select("gameweek").eq("league_id",active.league_id).order("gameweek",{ascending:false}).limit(1).maybeSingle(),
      supabase.rpc("transaction_window",{p_league_id:active.league_id}),
    ]);
    const loadedMatchups=(matchupResult.data??[]) as Matchup[];
    const scoredWeek=Number((scoreWeekResult.data as {gameweek?:number}|null)?.gameweek)||0;
    const windowWeek=Number(((windowResult.data??[]) as Array<{gameweek?:number}>)[0]?.gameweek)||0;
    const firstScheduledWeek=Math.min(...loadedMatchups.map(matchup=>matchup.gameweek));
    const activeWeek=windowWeek||scoredWeek||(Number.isFinite(firstScheduledWeek)?firstScheduledWeek:1);
    setGameweek(activeWeek);
    setManagers((orderResult.data??[]) as Manager[]);
    setMatchups(loadedMatchups);
    setLoading(false);
  },[]);

  useEffect(()=>{void load()},[load]);

  useEffect(()=>{
    const timer=window.setInterval(()=>setNow(Date.now()),30000);
    return()=>window.clearInterval(timer);
  },[]);

  useEffect(()=>{
    if(!selected)return;
    const close=(event:KeyboardEvent)=>{if(event.key==="Escape")setSelected(null)};
    const previous=document.body.style.overflow;
    document.body.style.overflow="hidden";
    window.addEventListener("keydown",close);
    return()=>{document.body.style.overflow=previous;window.removeEventListener("keydown",close)};
  },[selected]);

  useEffect(()=>{
    if(!league)return;
    let refreshTimer:number|undefined;
    const refreshLineups=()=>{
      setRefreshing(true);
      window.clearTimeout(refreshTimer);
      refreshTimer=window.setTimeout(()=>setLineupVersion(version=>version+1),400);
    };
    const channel=supabase.channel(`matchup-live-${league.league_id}`)
      .on("postgres_changes",{event:"*",schema:"public",table:"lineup_players",filter:`league_id=eq.${league.league_id}`},refreshLineups)
      .on("postgres_changes",{event:"*",schema:"public",table:"league_player_scores",filter:`league_id=eq.${league.league_id}`},refreshLineups)
      .on("postgres_changes",{event:"*",schema:"public",table:"league_matchups",filter:`league_id=eq.${league.league_id}`},refreshLineups)
      .subscribe();
    // Realtime is primary. This database-only heartbeat covers a temporarily
    // interrupted websocket without causing another football-provider request.
    const heartbeat=window.setInterval(()=>{if(document.visibilityState==="visible")refreshLineups()},15000);
    const refreshWhenVisible=()=>{if(document.visibilityState==="visible")refreshLineups()};
    window.addEventListener("pageshow",refreshLineups);
    document.addEventListener("visibilitychange",refreshWhenVisible);
    return()=>{
      window.removeEventListener("pageshow",refreshLineups);
      document.removeEventListener("visibilitychange",refreshWhenVisible);
      window.clearTimeout(refreshTimer);
      window.clearInterval(heartbeat);
      void supabase.removeChannel(channel);
    };
  },[league]);

  const weekFixtures=useMemo(()=>matchups.filter(matchup=>matchup.gameweek===gameweek),[matchups,gameweek]);
  const featured=useMemo(()=>weekFixtures.find(matchup=>matchup.id===selectedMatchupId)??weekFixtures.find(matchup=>matchup.home_user_id===userId||matchup.away_user_id===userId)??weekFixtures[0]??null,[weekFixtures,userId,selectedMatchupId]);
  const maxWeek=Math.max(1,...matchups.map(matchup=>matchup.gameweek));

  useEffect(()=>{
    if(!featured||!league)return;
    const request=++refreshRequest.current;
    void(async()=>{
      setLoading(true);
      const ids=[featured.home_user_id,featured.away_user_id];
      const[lineupResult,snapshotResult,picksResult,matchupResult,standingsResult]=await Promise.all([
        supabase.from("lineup_players").select("user_id,is_starter,is_captain,players(id,full_name,position,club,photo_url)").eq("league_id",league.league_id).in("user_id",ids),
        supabase.from("lineup_gameweek_players").select("user_id,is_starter,is_star_pick,players(id,full_name,position,club,photo_url)").eq("league_id",league.league_id).eq("gameweek",gameweek).in("user_id",ids),
        supabase.from("draft_picks").select("user_id,pick_number,players(id,full_name,position,club,photo_url)").eq("league_id",league.league_id).in("user_id",ids).order("pick_number"),
        supabase.from("league_matchups").select("home_score,away_score,status").eq("id",featured.id).single(),
        supabase.rpc("league_standings",{p_league_id:league.league_id}),
      ]);
      const lineupRows=(lineupResult.data??[]) as unknown as {user_id:string;is_starter:boolean;is_captain:boolean;players:Omit<Player,"score"|"rating"|"status"|"ledger"|"goals"|"assists"|"yellowCards"|"redCards">|null}[];
      const snapshotRows=(snapshotResult.data??[]) as unknown as {user_id:string;is_starter:boolean;is_star_pick:boolean;players:Omit<Player,"score"|"rating"|"status"|"ledger"|"goals"|"assists"|"yellowCards"|"redCards">|null}[];
      const pickRows=(picksResult.data??[]) as unknown as {user_id:string;pick_number:number;players:Omit<Player,"score"|"rating"|"status"|"ledger"|"goals"|"assists"|"yellowCards"|"redCards">|null}[];
      const relevantPlayerIds=[...new Set([...lineupRows,...snapshotRows,...pickRows].flatMap(row=>row.players?[row.players.id]:[]))];
      const scoreResult=relevantPlayerIds.length
        ?await supabase.from("league_player_scores").select("player_id,rating,minutes,goals,assists,shots_on_target,big_chances_missed,completed_passes,tackles_won,penalty_goals,penalties_missed,penalties_conceded,saves,penalties_saved,goals_conceded,yellow_cards,second_yellow_cards,red_cards,own_goals,status,fantasy_points,score_ledger").eq("league_id",league.league_id).eq("gameweek",gameweek).in("player_id",relevantPlayerIds)
        :{data:[]};
      const scoreRows=(scoreResult.data??[]) as ScoreRow[];
      const liveMatchup=matchupResult.data as {home_score:number|string;away_score:number|string;status:Matchup["status"]}|null;
      if(liveMatchup&&(Number(liveMatchup.home_score)!==Number(featured.home_score)||Number(liveMatchup.away_score)!==Number(featured.away_score)||liveMatchup.status!==featured.status)){
        setMatchups(current=>current.map(matchup=>matchup.id===featured.id?{...matchup,...liveMatchup}:matchup));
      }
      const scoredPlayer=(player:Omit<Player,"score"|"rating"|"status"|"ledger"|"goals"|"assists"|"yellowCards"|"redCards">,captain:boolean,lineupSet:boolean):Player=>{
        const row=scoreRows.find(score=>score.player_id===player.id);
        if(!row||!lineupSet)return{...player,captain,score:0,rating:null,status:"not_started",ledger:[],goals:0,assists:0,yellowCards:0,redCards:0};
        const baseScore=Number(row.fantasy_points??0);
        const ledger=Array.isArray(row.score_ledger)?row.score_ledger:[];
        const captainScore=captain?Math.floor(baseScore*1.5):baseScore;
        const captainBonus=captainScore-baseScore;
        const scoredLedger=captain?[...ledger,{code:"captain-bonus",label:"Captain +50%",detail:"Captain earns 50% additional fantasy points · final score rounded down",points:captainBonus}]:ledger;
        return{...player,captain,score:captainScore,rating:row.rating,status:row.status,ledger:scoredLedger,goals:row.goals,assists:row.assists,yellowCards:row.yellow_cards,redCards:row.red_cards};
      };
      const build=(owner:string,score:number|string):TeamView=>{
        const snapshot=snapshotRows.filter(row=>row.user_id===owner&&row.is_starter&&row.players).map(row=>({...row,is_captain:row.is_star_pick}));
        const current=lineupRows.filter(row=>row.user_id===owner&&row.is_starter&&row.players);
        const matchupStatus=liveMatchup?.status??featured.status;
        const saved=matchupStatus==="scheduled"?(current.length?current:snapshot):(snapshot.length?snapshot:current);
        const source=saved.length?saved.map(row=>scoredPlayer(row.players!,row.is_captain,true)):pickRows.filter(row=>row.user_id===owner&&row.players).slice(0,11).map(row=>scoredPlayer(row.players!,false,false));
        return{userId:owner,name:managers.find(manager=>manager.user_id===owner)?.team_name??"Manager",score:Number(score),players:source.sort((a,b)=>(positionOrder[a.position]??9)-(positionOrder[b.position]??9)),lineupSet:saved.length>0};
      };
      if(request===refreshRequest.current){
        const nextTeams=[build(featured.home_user_id,liveMatchup?.home_score??featured.home_score),build(featured.away_user_id,liveMatchup?.away_score??featured.away_score)];
        setTeams(nextTeams);
        setSelected(current=>current?nextTeams.flatMap(team=>team.players).find(player=>player.id===current.id)??current:null);
        setStandings((standingsResult.data??[]) as Standing[]);
        setLastUpdated(new Date());
        setLoading(false);setRefreshing(false);
      }
    })();
  },[featured,league,managers,gameweek,lineupVersion]);

  const freshness=lastUpdated?(()=>{const seconds=Math.max(0,Math.floor((now-lastUpdated.getTime())/1000));if(seconds<15)return"Updated just now";if(seconds<60)return`Updated ${seconds}s ago`;const minutes=Math.floor(seconds/60);return`Updated ${minutes}m ago`})():"Waiting for first score sync";

  return <PageShell eyebrow={league?.league_name??"LEAGUE MATCHUPS"} title="Head to head">
    <div className="gameweek-picker"><button disabled={gameweek===1} onClick={()=>{setSelectedMatchupId(null);setGameweek(week=>week-1)}}>←</button><label>Gameweek<select value={gameweek} onChange={event=>{setSelectedMatchupId(null);setGameweek(Number(event.target.value))}}>{Array.from({length:maxWeek},(_,index)=>index+1).map(week=><option key={week}>{week}</option>)}</select></label><button disabled={gameweek===maxWeek} onClick={()=>{setSelectedMatchupId(null);setGameweek(week=>week+1)}}>→</button></div>
    {loading&&teams.length===0?<section className="panel empty-state">Loading the league schedule…</section>:null}
    {message?<section className="panel empty-state">{message}</section>:null}
    {featured&&teams.length===2?<>
      <section className="match-card gameweek-score real-score">
        <span className="simulation-chip">{featured.status==="final"?"FINAL":featured.status==="live"?"LIVE":"SCHEDULED"}</span>
        <div className="versus"><div><strong>{teams[0].score}</strong><span>{teams[0].name}</span></div><div className="versus-mark">VS</div><div><strong>{teams[1].score}</strong><span>{teams[1].name}</span></div></div>
        <div className="progress"><span style={{width:teams[0].score+teams[1].score>0?`${teams[0].score/(teams[0].score+teams[1].score)*100}%`:"50%"}}/></div>
        <div className="match-status"><span className="live-dot"/> {refreshing?"Updating scores…":featured.status==="scheduled"?"Scores begin when live match data is connected":featured.status==="live"?"Scoring in progress":"Matchup complete"}</div>
        <p className="score-freshness" aria-live="polite">{refreshing?"Synchronizing latest stored data…":featured.status==="final"?`${freshness} · final data checked`:freshness}</p>
      </section>
      <section className="panel matchup-pitch-card"><div className="lineup-pitch shared-matchup-pitch"><span className="pitch-markings" aria-hidden="true"/>{teams[0]?<div className="pitch-half home-half">{homePitchRows.map(position=>{const players=teams[0].players.filter(player=>player.position===position);return <div className={`pitch-row ${position.toLowerCase()}`} key={`home-${position}`} style={{gridTemplateColumns:`repeat(${Math.max(players.length,1)}, minmax(0, 1fr))`}}>{players.map(player=><PitchPlayer player={player} onSelect={setSelected} key={player.id}/>)}</div>})}</div>:null}{teams[1]?<div className="pitch-half away-half">{awayPitchRows.map(position=>{const players=teams[1].players.filter(player=>player.position===position);return <div className={`pitch-row ${position.toLowerCase()}`} key={`away-${position}`} style={{gridTemplateColumns:`repeat(${Math.max(players.length,1)}, minmax(0, 1fr))`}}>{players.map(player=><PitchPlayer player={player} onSelect={setSelected} key={player.id}/>)}</div>})}</div>:null}</div>{teams.some(team=>team.players.length===0)?<p className="empty-state">A starting XI has not been saved for this matchup yet.</p>:null}</section>
      <section className="panel fixture-list"><div className="section-row"><div><h2>Gameweek {gameweek} fixtures</h2><small className="lineup-state">Open any matchup to view both Starting XIs and scoring ledgers.</small></div><span className="muted-chip">{weekFixtures.length}</span></div>{weekFixtures.map(matchup=><button className={`fixture-row fixture-button${featured.id===matchup.id?" active":""}`} key={matchup.id} onClick={()=>{if(featured.id===matchup.id)return;setTeams([]);setSelectedMatchupId(matchup.id);setSelected(null);window.scrollTo({top:0,behavior:"smooth"})}} aria-label={`Open ${managers.find(manager=>manager.user_id===matchup.home_user_id)?.team_name??"home team"} versus ${managers.find(manager=>manager.user_id===matchup.away_user_id)?.team_name??"away team"}`} aria-current={featured.id===matchup.id?"true":undefined}><span>{managers.find(manager=>manager.user_id===matchup.home_user_id)?.team_name}</span><b>{Number(matchup.home_score)}–{Number(matchup.away_score)}</b><span>{managers.find(manager=>manager.user_id===matchup.away_user_id)?.team_name}</span><i aria-hidden="true">›</i></button>)}</section>
      <section className="panel standings-result"><div className="section-row"><h2>League table</h2><span className="muted-chip">LIVE TABLE</span></div><div className="standings-head"><span>#</span><span>Team</span><span>P</span><span>W-D-L</span><span>Pts</span><span>FP</span></div>{standings.map(row=><div className="standing-row" key={row.user_id}><span>{row.rank}</span><strong>{row.team_name}</strong><span>{row.played}</span><span>{row.wins}-{row.draws}-{row.losses}</span><b>{row.points}</b><span>{Number(row.fantasy_points)}</span></div>)}</section>
    </>:null}
    {selected?<div className="confirm-overlay ledger-overlay" role="presentation" onClick={()=>setSelected(null)}><section className="confirm-card player-ledger" role="dialog" aria-modal="true" aria-labelledby="ledger-player-name" onClick={event=>event.stopPropagation()}><div className="ledger-sheet-handle" aria-hidden="true"/><header className="ledger-header"><span className={`position ${selected.position.toLowerCase()}`}>{selected.position}</span><button className="ledger-close" onClick={()=>setSelected(null)} aria-label="Close scoring breakdown" autoFocus>×</button></header><div className="ledger-scroll"><p className="eyebrow">SCORING BREAKDOWN</p><h2 id="ledger-player-name">{selected.full_name}</h2><p>{selected.club}{selected.captain?" · Captain":""}</p>{selected.rating!==null?<div className="match-award-summary"><span><small>API MATCH RATING</small><strong>{selected.rating.toFixed(1)}</strong></span></div>:null}<div className="ledger-total"><span>Fantasy points</span><strong>{selected.score}</strong></div>{selected.ledger.length?<><div className="ledger">{selected.ledger.map(entry=><div key={entry.code}><span><strong>{entry.label}</strong><small>{entry.detail}</small></span><b className={entry.points<0?"negative":"positive"}>{entry.points>0?"+":""}{entry.points}</b></div>)}</div><div className="ledger-reconcile"><span>Ledger total</span><strong>{selected.score} pts</strong></div></>:<div className="ledger-empty"><strong>{selected.status==="not_started"?"Match statistics have not arrived yet":selected.status==="live"?"Live statistics are still syncing":"Final statistics are still reconciling"}</strong><p>{selected.status==="not_started"?"Scoring will begin automatically after the player appears and the provider sends match data.":selected.status==="live"?"This player will update automatically when the next stored-data refresh completes.":"We will keep checking the completed fixture for its final player statistics."}</p></div>}</div></section></div>:null}
  </PageShell>;
}
