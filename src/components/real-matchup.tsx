"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageShell } from "./page-shell";
import { supabase } from "@/lib/supabase";
import { type LedgerEntry } from "@/lib/scoring";
import { returnEstimateLabel } from "@/lib/return-estimate";
import { fantasyWeekWindow, fixtureInsideFantasyWeek } from "@/lib/fantasy-week-window";
import { resolveActiveLeague } from "@/lib/active-league";
import { PlayerHeadshot } from "./player-headshot";
import { partitionMatchupLineup, selectMatchupLineup } from "@/lib/matchup-lineup";
import { fixtureForClub, normalizeClubName, playerDataStatusCopy, resolvePlayerDataStatus, type PlayerDataStatus, type PlayerFixture } from "@/lib/matchup-player-status";
import { loadPlayerSeasonTotals, type PlayerSeasonTotal } from "@/lib/player-season-totals";
import { managerTrend, matchupForecast } from "@/lib/matchup-preview";

type League={league_id:string;league_name:string;team_name:string;game_format:string};
type Manager={draft_slot:number;user_id:string;team_name:string};
type Matchup={id:string;gameweek:number;home_user_id:string;away_user_id:string;home_score:number|string;away_score:number|string;status:"scheduled"|"live"|"final"};
type PlayerSource={id:number;full_name:string;position:string;club:string;competition?:string|null;photo_url?:string|null;injured?:boolean;injury_type?:string|null;injury_reason?:string|null;expected_return?:string|null;fotmob_expected_return?:string|null};
type Player={id:number;full_name:string;position:string;club:string;competition?:string|null;photo_url?:string|null;injured?:boolean;injury_type?:string|null;injury_reason?:string|null;expected_return?:string|null;fotmob_expected_return?:string|null;captain?:boolean;isBench?:boolean;score:number;baseScore:number;rating:number|null;minutes:number;status:"not_started"|"live"|"final";dataStatus:PlayerDataStatus;ledger:LedgerEntry[];goals:number;assists:number;yellowCards:number;redCards:number;fixture:PlayerFixture|null;stats:ScoreRow|null};
type TeamView={userId:string;name:string;score:number;players:Player[];bench:Player[];lineupSet:boolean};
type ScoreRow={player_id:number;rating:number|null;minutes:number;goals:number;assists:number;shots_on_target:number;big_chances_missed:number;completed_passes:number;tackles_won:number;penalty_goals:number;penalties_missed:number;penalties_conceded:number;saves:number;penalties_saved:number;goals_conceded:number;yellow_cards:number;second_yellow_cards:number;red_cards:number;own_goals:number;stats_received:boolean;status:"not_started"|"live"|"final";fantasy_points:number|string;score_ledger:LedgerEntry[]};
type HistoryRow={fixture_id:number;gameweek:number;kickoff:string;rating:number|null;minutes:number;goals:number;assists:number;shots_on_target:number;completed_passes:number;saves:number;goals_conceded:number;yellow_cards:number;red_cards:number;status:string;home_team:string;away_team:string;home_score:number|null;away_score:number|null;points:number|string};
type Standing={rank:number;user_id:string;team_name:string;played:number;wins:number;draws:number;losses:number;points:number;fantasy_points:number|string};
type HeadlineFixture=PlayerFixture&{competition:string;gameweek:number};

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
    <small>{player.position} · {fixtureLabel(player.fixture,player.club)}</small>
  </button>;
}

function BenchPlayer({player,onSelect}:{player:Player;onSelect:(player:Player)=>void}){
  const words=player.full_name.trim().split(/\s+/);
  const displayName=player.full_name.length>18&&words.length>1?`${words[0][0]}. ${words.slice(1).join(" ")}`:player.full_name;
  return <button className="bench-player" onClick={()=>onSelect(player)} aria-label={`Open ${player.full_name} bench scoring card`}>
    <span className="bench-player-photo"><PlayerHeadshot name={player.full_name} position={player.position} photoUrl={player.photo_url}/><EventBadges player={player}/></span>
    <span className="bench-player-copy"><strong title={player.full_name}>{displayName}</strong><small>{player.position} · {player.club}</small><small className="active-player-fixture compact"><b>{fixtureLabel(player.fixture,player.club)}</b>{player.fixture?<i>{new Date(player.fixture.kickoff).toLocaleString([], {weekday:"short",hour:"numeric",minute:"2-digit"})}</i>:null}</small></span>
    <b className={player.score<0?"negative":"positive"}>{player.score} pts</b>
  </button>;
}

function PlayerStatus({status}:{status:PlayerDataStatus}){
  return <span className={`player-data-status status-${status}`}>{playerDataStatusCopy[status].label}</span>;
}

function fixtureOpponent(fixture:PlayerFixture|null,club:string){
  if(!fixture)return"Opponent to be confirmed";
  return normalizeClubName(fixture.home_team)===normalizeClubName(club)?fixture.away_team:fixture.home_team;
}
function fixtureLabel(fixture:PlayerFixture|null,club:string){
  if(!fixture)return"Fixture pending";
  return `${normalizeClubName(fixture.home_team)===normalizeClubName(club)?"vs":"@"} ${fixtureOpponent(fixture,club)}`;
}
function teamMonogram(name:string){
  const words=name.trim().split(/\s+/).filter(Boolean);
  return (words.length>1?`${words[0][0]}${words.at(-1)?.[0]??""}`:words[0]?.slice(0,2)??"XI").toUpperCase();
}

function MatchupPlayerDialog({player,gameweek,lastUpdated,onClose}:{player:Player;gameweek:number;lastUpdated:Date|null;onClose:()=>void}){
  const[history,setHistory]=useState<HistoryRow[]>([]),[historyLoading,setHistoryLoading]=useState(true);
  useEffect(()=>{let active=true;setHistoryLoading(true);void supabase.rpc("player_season_history",{p_player_id:player.id}).then(({data})=>{if(active){setHistory((data??[]) as HistoryRow[]);setHistoryLoading(false)}});return()=>{active=false}},[player.id]);
  const season=useMemo(()=>history.reduce((total,row)=>({points:total.points+Number(row.points),appearances:total.appearances+(row.minutes>0?1:0),minutes:total.minutes+row.minutes,goals:total.goals+row.goals,assists:total.assists+row.assists}),{points:0,appearances:0,minutes:0,goals:0,assists:0}),[history]);
  const recent=[...history].sort((a,b)=>new Date(b.kickoff).getTime()-new Date(a.kickoff).getTime()).slice(0,5);
  const started=player.dataStatus!=="upcoming";
  const fixture=player.fixture;
  const returnDate=player.fotmob_expected_return??player.expected_return;
  const statItems=player.stats?[{label:"Minutes",value:player.minutes},{label:"Goals",value:player.stats.goals},{label:"Assists",value:player.stats.assists},{label:"Shots on target",value:player.stats.shots_on_target},{label:"Completed passes",value:player.stats.completed_passes},{label:player.position==="GK"?"Saves":"Goals conceded",value:player.position==="GK"?player.stats.saves:player.stats.goals_conceded}]:[];
  return <div className="confirm-overlay ledger-overlay" role="presentation" onClick={onClose}>
    <section className="confirm-card player-ledger matchup-player-report" role="dialog" aria-modal="true" aria-labelledby="ledger-player-name" onClick={event=>event.stopPropagation()}>
      <div className="ledger-sheet-handle" aria-hidden="true"/>
      <header className="ledger-header"><span className={`position ${player.position.toLowerCase()}`}>{player.position}</span>{player.isBench?<span className="bench-ledger-label">BENCH · NOT COUNTED</span>:null}<button className="ledger-close" onClick={onClose} aria-label="Close player report" autoFocus>×</button></header>
      <div className="ledger-scroll">
        <section className="matchup-player-identity"><PlayerHeadshot name={player.full_name} position={player.position} photoUrl={player.photo_url}/><div><p className="eyebrow">GAMEWEEK {gameweek} REPORT</p><h2 id="ledger-player-name">{player.full_name}</h2><p>{player.club}{player.competition?` · ${player.competition}`:""}{player.captain?" · Captain":""}</p></div></section>
        <section className="matchup-fixture-summary"><div><small>{fixture?new Date(fixture.kickoff).toLocaleString([], {weekday:"short",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}):"FIXTURE PENDING"}</small><strong>{fixtureLabel(fixture,player.club)}</strong><span>{fixture?fixture.status.replaceAll("_"," "):"The fixture has not synchronized yet."}</span></div><PlayerStatus status={player.dataStatus}/></section>
        <div className={`ledger-data-status status-${player.dataStatus}`}><PlayerStatus status={player.dataStatus}/><span><strong>{playerDataStatusCopy[player.dataStatus].title}</strong><small>{playerDataStatusCopy[player.dataStatus].detail}</small></span></div>
        {player.injured?<section className="matchup-availability"><small>AVAILABILITY</small><strong>{player.injury_reason??player.injury_type??"Unavailable"}</strong>{returnDate?<span>Expected return: {returnEstimateLabel(returnDate)}</span>:null}</section>:null}
        <section className="matchup-points-hero"><div><small>{player.isBench?"BENCH POINTS":"GAMEWEEK POINTS"}</small><strong>{player.score}</strong></div>{player.captain?<div><small>BEFORE CAPTAIN</small><strong>{player.baseScore}</strong><span>+50% applied</span></div>:null}{player.rating!==null?<div><small>API RATING</small><strong>{player.rating.toFixed(1)}</strong></div>:null}</section>
        {started&&statItems.length?<section className="matchup-live-stats">{statItems.map(item=><div key={item.label}><strong>{item.value}</strong><small>{item.label}</small></div>)}</section>:null}
        <section className="matchup-season-block"><div className="section-row"><div><p className="eyebrow">SEASON SNAPSHOT</p><h3>Form and production</h3></div><span className="muted-chip">{historyLoading?"LOADING":`${season.points} PTS`}</span></div><div className="matchup-season-stats"><div><strong>{season.appearances}</strong><small>Apps</small></div><div><strong>{season.minutes}</strong><small>Minutes</small></div><div><strong>{season.goals}</strong><small>Goals</small></div><div><strong>{season.assists}</strong><small>Assists</small></div></div>{recent.length?<div className="matchup-recent-form">{recent.map(row=><div key={row.fixture_id}><span><strong>GW {row.gameweek} · vs {fixtureOpponent(row,player.club)}</strong><small>{row.minutes} min{row.rating!==null?` · ${Number(row.rating).toFixed(1)} rating`:""}</small></span><b>{Number(row.points)} pts</b></div>)}</div>:!historyLoading?<p className="ledger-history-empty">No completed match history has been stored yet.</p>:null}</section>
        <section className="matchup-ledger-block"><div className="section-row"><div><p className="eyebrow">SCORING LEDGER</p><h3>{started?"How the points were earned":"Available when the match starts"}</h3></div></div>{started?(player.ledger.length?<><div className="ledger">{player.ledger.map(entry=><div key={entry.code}><span><strong>{entry.label}</strong><small>{entry.detail}</small></span><b className={entry.points<0?"negative":"positive"}>{entry.points>0?"+":""}{entry.points}</b></div>)}</div><div className="ledger-reconcile"><span>Ledger total</span><strong>{player.score} pts</strong></div></>:<div className="ledger-empty"><strong>{playerDataStatusCopy[player.dataStatus].title}</strong><p>{playerDataStatusCopy[player.dataStatus].detail}</p></div>):<div className="ledger-empty"><strong>Scoring has not opened</strong><p>The itemized ledger will appear here as soon as this player’s fixture begins.</p></div>}</section>
        {player.isBench?<p className="bench-points-note">These points show the player’s performance but are excluded from the matchup total.</p>:null}<p className="matchup-report-freshness">{lastUpdated?`Stored data refreshed ${lastUpdated.toLocaleTimeString([], {hour:"numeric",minute:"2-digit",second:"2-digit"})}`:"Waiting for the first stored-data refresh"}</p>
      </div>
    </section>
  </div>;
}

export function RealMatchup(){
  const[league,setLeague]=useState<League|null>(null);
  const[userId,setUserId]=useState<string|null>(null);
  const[managers,setManagers]=useState<Manager[]>([]);
  const[matchups,setMatchups]=useState<Matchup[]>([]);
  const[gameweek,setGameweek]=useState(1);
  const[teams,setTeams]=useState<TeamView[]>([]);
  const[standings,setStandings]=useState<Standing[]>([]);
  const[seasonTotals,setSeasonTotals]=useState<PlayerSeasonTotal[]>([]);
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
    if(!league)return;
    let active=true;
    void loadPlayerSeasonTotals().then(result=>{
      if(active&&!result.error)setSeasonTotals(result.data);
    });
    return()=>{active=false};
  },[league]);

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
  const seasonTotalByPlayer=useMemo(()=>new Map(seasonTotals.map(total=>[total.player_id,total])),[seasonTotals]);
  const managerPreviews=useMemo(()=>teams.map(team=>{
    const standing=standings.find(row=>row.user_id===team.userId);
    const trend=managerTrend(matchups,team.userId,gameweek);
    const players=[...team.players].sort((a,b)=>{
      const pointsDifference=(seasonTotalByPlayer.get(b.id)?.points??0)-(seasonTotalByPlayer.get(a.id)?.points??0);
      if(pointsDifference!==0)return pointsDifference;
      if(Boolean(a.captain)!==Boolean(b.captain))return a.captain?-1:1;
      return a.full_name.localeCompare(b.full_name);
    }).slice(0,2);
    const lineupPoints=team.players.reduce((total,player)=>total+(seasonTotalByPlayer.get(player.id)?.points??0),0);
    return{team,standing,players,lineupPoints,...trend};
  }),[teams,standings,matchups,gameweek,seasonTotalByPlayer]);
  const forecast=useMemo(()=>managerPreviews.length===2?matchupForecast(managerPreviews[0],managerPreviews[1]):null,[managerPreviews]);
  const previousMeetings=useMemo(()=>{
    if(!featured)return[];
    return matchups.filter(matchup=>matchup.id!==featured.id&&matchup.status==="final"&&matchup.gameweek<featured.gameweek&&((matchup.home_user_id===featured.home_user_id&&matchup.away_user_id===featured.away_user_id)||(matchup.home_user_id===featured.away_user_id&&matchup.away_user_id===featured.home_user_id)));
  },[featured,matchups]);
  const headToHead=useMemo(()=>{
    if(!featured)return{homeWins:0,awayWins:0,draws:0};
    return previousMeetings.reduce((record,matchup)=>{
      const featuredHomeWasHome=matchup.home_user_id===featured.home_user_id;
      const featuredHomeScore=Number(featuredHomeWasHome?matchup.home_score:matchup.away_score);
      const featuredAwayScore=Number(featuredHomeWasHome?matchup.away_score:matchup.home_score);
      if(featuredHomeScore>featuredAwayScore)record.homeWins+=1;
      else if(featuredAwayScore>featuredHomeScore)record.awayWins+=1;
      else record.draws+=1;
      return record;
    },{homeWins:0,awayWins:0,draws:0});
  },[featured,previousMeetings]);
  useEffect(()=>{
    if(!featured||!league)return;
    const request=++refreshRequest.current;
    void(async()=>{
      setLoading(true);
      const ids=[featured.home_user_id,featured.away_user_id];
      const[lineupResult,snapshotResult,picksResult,matchupResult,standingsResult,fixturesResult,leagueConfigResult]=await Promise.all([
        supabase.from("lineup_players").select("user_id,is_starter,is_captain,pitch_order,bench_order,players(id,full_name,position,club,competition,photo_url,injured,injury_type,injury_reason,expected_return,fotmob_expected_return)").eq("league_id",league.league_id).in("user_id",ids),
        supabase.from("lineup_gameweek_players").select("user_id,is_starter,is_star_pick,pitch_order,players(id,full_name,position,club,competition,photo_url,injured,injury_type,injury_reason,expected_return,fotmob_expected_return)").eq("league_id",league.league_id).eq("gameweek",gameweek).in("user_id",ids),
        supabase.from("draft_picks").select("user_id,pick_number,players(id,full_name,position,club,competition,photo_url,injured,injury_type,injury_reason,expected_return,fotmob_expected_return)").eq("league_id",league.league_id).in("user_id",ids).order("pick_number"),
        supabase.from("league_matchups").select("home_score,away_score,status").eq("id",featured.id).single(),
        supabase.rpc("league_standings",{p_league_id:league.league_id}),
        supabase.from("league_headline_fixtures").select("status,kickoff,home_team,away_team,competition,gameweek").eq("league_id",league.league_id).eq("gameweek",gameweek),
        supabase.rpc("league_calendar_competition",{p_league_id:league.league_id}),
      ]);
      if(fixturesResult.error||leagueConfigResult.error){
        if(request===refreshRequest.current){
          setMessage(fixturesResult.error?.message??leagueConfigResult.error?.message??"The matchup fixtures could not be loaded.");
          setLoading(false);setRefreshing(false);
        }
        return;
      }
      const lineupRows=(lineupResult.data??[]) as unknown as {user_id:string;is_starter:boolean;is_captain:boolean;pitch_order:number|null;bench_order:number|null;players:PlayerSource|null}[];
      const snapshotRows=(snapshotResult.data??[]) as unknown as {user_id:string;is_starter:boolean;is_star_pick:boolean;pitch_order:number|null;bench_order?:number|null;players:PlayerSource|null}[];
      const pickRows=(picksResult.data??[]) as unknown as {user_id:string;pick_number:number;players:PlayerSource|null}[];
      const relevantPlayerIds=[...new Set([...lineupRows,...snapshotRows,...pickRows].flatMap(row=>row.players?[row.players.id]:[]))];
      const allFixtures=(fixturesResult.data??[]) as HeadlineFixture[];
      const calendarCompetition=leagueConfigResult.data as string|null;
      const calendarFixtures=allFixtures.filter(fixture=>fixture.competition===calendarCompetition&&fixture.gameweek===gameweek);
      const scoringWindow=fantasyWeekWindow(calendarFixtures);
      const[scoreResult,playerFixtureResult]=await Promise.all([
        relevantPlayerIds.length
          ?supabase.from("league_player_scores").select("player_id,rating,minutes,goals,assists,shots_on_target,big_chances_missed,completed_passes,tackles_won,penalty_goals,penalties_missed,penalties_conceded,saves,penalties_saved,goals_conceded,yellow_cards,second_yellow_cards,red_cards,own_goals,stats_received,status,fantasy_points,score_ledger").eq("league_id",league.league_id).eq("gameweek",gameweek).in("player_id",relevantPlayerIds)
          :Promise.resolve({data:[]}),
        scoringWindow
          ?supabase.from("league_headline_fixtures").select("status,kickoff,home_team,away_team,competition,gameweek").eq("league_id",league.league_id).gte("kickoff",scoringWindow.startsAt).lte("kickoff",scoringWindow.endsAt)
          :Promise.resolve({data:calendarFixtures,error:null}),
      ]);
      if(playerFixtureResult.error){
        if(request===refreshRequest.current){
          setMessage(playerFixtureResult.error.message);
          setLoading(false);setRefreshing(false);
        }
        return;
      }
      const scoreRows=(scoreResult.data??[]) as ScoreRow[];
      const playerFixtures=((playerFixtureResult.data??[]) as HeadlineFixture[]).filter(fixture=>!scoringWindow||fixtureInsideFantasyWeek(fixture,scoringWindow));
      const liveMatchup=matchupResult.data as {home_score:number|string;away_score:number|string;status:Matchup["status"]}|null;
      if(liveMatchup&&(Number(liveMatchup.home_score)!==Number(featured.home_score)||Number(liveMatchup.away_score)!==Number(featured.away_score)||liveMatchup.status!==featured.status)){
        setMatchups(current=>current.map(matchup=>matchup.id===featured.id?{...matchup,...liveMatchup}:matchup));
      }
      const scoredPlayer=(player:PlayerSource,captain:boolean,lineupSet:boolean):Player=>{
        const row=scoreRows.find(score=>score.player_id===player.id);
        const fixture=fixtureForClub(playerFixtures,player.club);
        const hasStoredStats=Boolean(row&&(row.stats_received||row.minutes>0||row.rating!==null||Number(row.fantasy_points)!==0||(Array.isArray(row.score_ledger)&&row.score_ledger.length>0)));
        const dataStatus=resolvePlayerDataStatus({fixtureStatus:fixture?.status,scoreStatus:row?.status,minutes:row?.minutes??0,statsReceived:hasStoredStats});
        if(!row||!lineupSet)return{...player,captain,score:0,baseScore:0,rating:null,minutes:0,status:"not_started",dataStatus,ledger:[],goals:0,assists:0,yellowCards:0,redCards:0,fixture,stats:null};
        const baseScore=Number(row.fantasy_points??0);
        const ledger=Array.isArray(row.score_ledger)?row.score_ledger:[];
        const captainScore=captain?Math.floor(baseScore*1.5):baseScore;
        const captainBonus=captainScore-baseScore;
        const scoredLedger=captain?[...ledger,{code:"captain-bonus",label:"Captain +50%",detail:"Captain earns 50% additional fantasy points · final score rounded down",points:captainBonus}]:ledger;
        return{...player,captain,score:captainScore,baseScore,rating:row.rating,minutes:row.minutes,status:row.status,dataStatus,ledger:scoredLedger,goals:row.goals,assists:row.assists,yellowCards:row.yellow_cards,redCards:row.red_cards,fixture,stats:row};
      };
      const build=(owner:string,score:number|string):TeamView=>{
        const snapshot=snapshotRows.filter(row=>row.user_id===owner&&row.players).map(row=>({...row,bench_order:null,is_captain:row.is_star_pick}));
        const current=lineupRows.filter(row=>row.user_id===owner&&row.players);
        const matchupStatus=liveMatchup?.status??featured.status;
        const saved=selectMatchupLineup(matchupStatus,current,snapshot);
        const partitioned=partitionMatchupLineup(saved);
        const ownerPicks=pickRows.filter(row=>row.user_id===owner&&row.players);
        const starterSource=saved.length?partitioned.starters.map(row=>scoredPlayer(row.players!,row.is_captain,true)):ownerPicks.slice(0,11).map(row=>scoredPlayer(row.players!,false,false));
        const benchSource=saved.length?partitioned.bench.map(row=>({...scoredPlayer(row.players!,false,true),isBench:true})):ownerPicks.slice(11).map(row=>({...scoredPlayer(row.players!,false,false),isBench:true}));
        return{userId:owner,name:managers.find(manager=>manager.user_id===owner)?.team_name??"Manager",score:Number(score),players:starterSource.sort((a,b)=>(positionOrder[a.position]??9)-(positionOrder[b.position]??9)),bench:benchSource,lineupSet:saved.length>0};
      };
      if(request===refreshRequest.current){
        const nextTeams=[build(featured.home_user_id,liveMatchup?.home_score??featured.home_score),build(featured.away_user_id,liveMatchup?.away_score??featured.away_score)];
        setTeams(nextTeams);
        setSelected(current=>current?nextTeams.flatMap(team=>[...team.players,...team.bench]).find(player=>player.id===current.id)??current:null);
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
      <section className={`match-card gameweek-score real-score${featured.status==="scheduled"?" matchday-preview":""}`}>
        {featured.status==="scheduled"?<>
          <div className="matchday-kicker"><span>MATCHUP PREVIEW</span><b>GAMEWEEK {gameweek}</b></div>
          <div className="matchday-hero">
            <div className="matchday-manager home"><small>HOME XI</small><div className="manager-monogram" aria-hidden="true">{teamMonogram(managerPreviews[0].team.name)}</div><strong>{managerPreviews[0].team.name}</strong><span>{managerPreviews[0].standing?`#${managerPreviews[0].standing.rank} · ${managerPreviews[0].standing.wins}-${managerPreviews[0].standing.draws}-${managerPreviews[0].standing.losses}`:"Season opening"}</span></div>
            <div className="matchday-vs"><span aria-label="versus"><b>V</b><i aria-hidden="true"/><b>S</b></span></div>
            <div className="matchday-manager away"><small>AWAY XI</small><div className="manager-monogram" aria-hidden="true">{teamMonogram(managerPreviews[1].team.name)}</div><strong>{managerPreviews[1].team.name}</strong><span>{managerPreviews[1].standing?`#${managerPreviews[1].standing.rank} · ${managerPreviews[1].standing.wins}-${managerPreviews[1].standing.draws}-${managerPreviews[1].standing.losses}`:"Season opening"}</span></div>
          </div>
          <div className="matchday-history"><span>HEAD TO HEAD</span><strong>{previousMeetings.length?`${headToHead.homeWins}–${headToHead.draws}–${headToHead.awayWins}`:"First meeting"}</strong></div>
          {forecast?<section className="matchup-forecast" aria-label="Form-based matchup forecast">
            <div className="forecast-heading"><span><small>PERFORMANCE PROJECTION</small><strong>{forecast.leader==="even"?"Too close to call":`${forecast.leader==="home"?managerPreviews[0].team.name:managerPreviews[1].team.name} has the edge`}</strong></span><b><small>PROJECTED PTS</small>{forecast.homeScore.toFixed(0)} <i>–</i> {forecast.awayScore.toFixed(0)}</b></div>
            <div className="forecast-meter"><span style={{width:`${forecast.homeShare}%`}}/><i style={{left:`${forecast.homeShare}%`}}/></div>
            <div className="forecast-shares"><span>{forecast.homeShare}% share</span><small>Projected scoring share · not win probability · based on {Math.min(managerPreviews[0]?.played??0,managerPreviews[1]?.played??0)} completed GWs</small><span>{forecast.awayShare}% share</span></div>
          </section>:null}
          <div className="matchup-comparison">
            <p><span>TEAM METRIC</span><b>SEASON COMPARISON</b></p>
            {[{label:"Avg score",home:managerPreviews[0]?.averageFor??0,away:managerPreviews[1]?.averageFor??0},{label:"Avg allowed",home:managerPreviews[0]?.averageAgainst??0,away:managerPreviews[1]?.averageAgainst??0},{label:"Starting XI points",home:managerPreviews[0]?.lineupPoints??0,away:managerPreviews[1]?.lineupPoints??0}].map(metric=>{const max=Math.max(metric.home,metric.away,1);return <div className="comparison-row" key={metric.label}><b>{metric.home.toFixed(metric.label==="Starting XI points"?0:1)}</b><span><small>{metric.label}</small><i><em style={{width:`${metric.home/max*100}%`}}/><em style={{width:`${metric.away/max*100}%`}}/></i></span><b>{metric.away.toFixed(metric.label==="Starting XI points"?0:1)}</b></div>})}
          </div>
          <div className="matchup-form-row">{managerPreviews.map(({team,form})=><div key={team.userId}><small>RECENT FORM</small><span>{form.length?form.map((result,index)=><i className={`form-${result.toLowerCase()}`} key={`${result}-${index}`}>{result}</i>):<em>No results yet</em>}</span></div>)}</div>
          <div className="impact-players"><div className="impact-heading"><span>IMPACT PLAYERS</span><small>Tap a player for the full report</small></div><div className="impact-grid">{managerPreviews.map(({team,players})=><article key={team.userId}><header>{team.name}</header>{players.length?players.map((player,index)=>{const total=seasonTotalByPlayer.get(player.id);const appearances=total?.appearances??0;const contributions=(total?.goals??0)+(total?.assists??0);return <button key={player.id} onClick={()=>setSelected(player)} aria-label={`Open ${player.full_name} preview`}><span className="impact-rank">0{index+1}</span><PlayerHeadshot name={player.full_name} position={player.position} photoUrl={player.photo_url}/><span className="impact-copy"><strong>{player.full_name}{player.captain?<i>★</i>:null}</strong><small>{player.position} · {fixtureLabel(player.fixture,player.club)}</small><em>{appearances?`${((total?.points??0)/appearances).toFixed(1)} pts/app`:"No appearances"} · {contributions} G+A · {appearances} apps</em></span><b>{total?.points??0}<small>PTS</small></b></button>}):<span className="preview-empty">Lineup pending</span>}</article>)}</div></div>
          <p className="matchday-note" aria-live="polite"><span/>Live scores and player ledgers take over at kickoff.</p>
        </>:<>
          <span className="simulation-chip">{featured.status==="final"?"FINAL":"LIVE"}</span>
          <div className="versus"><div><strong>{teams[0].score}</strong><span>{teams[0].name}</span></div><div className="versus-mark">VS</div><div><strong>{teams[1].score}</strong><span>{teams[1].name}</span></div></div>
          <div className="progress"><span style={{width:teams[0].score+teams[1].score>0?`${teams[0].score/(teams[0].score+teams[1].score)*100}%`:"50%"}}/></div>
          <div className="match-status"><span className="live-dot"/> {refreshing?"Updating scores…":featured.status==="live"?"Scoring in progress":"Matchup complete"}</div>
          <p className="score-freshness" aria-live="polite">{refreshing?"Synchronizing latest stored data…":featured.status==="final"?`${freshness} · final data checked`:freshness}</p>
        </>}
      </section>
      <section className="panel matchup-pitch-card"><div className="lineup-pitch shared-matchup-pitch"><span className="pitch-markings" aria-hidden="true"/>{teams[0]?<div className="pitch-half home-half">{homePitchRows.map(position=>{const players=teams[0].players.filter(player=>player.position===position);return <div className={`pitch-row ${position.toLowerCase()}`} key={`home-${position}`} style={{gridTemplateColumns:`repeat(${Math.max(players.length,1)}, minmax(0, 1fr))`}}>{players.map(player=><PitchPlayer player={player} onSelect={setSelected} key={player.id}/>)}</div>})}</div>:null}{teams[1]?<div className="pitch-half away-half">{awayPitchRows.map(position=>{const players=teams[1].players.filter(player=>player.position===position);return <div className={`pitch-row ${position.toLowerCase()}`} key={`away-${position}`} style={{gridTemplateColumns:`repeat(${Math.max(players.length,1)}, minmax(0, 1fr))`}}>{players.map(player=><PitchPlayer player={player} onSelect={setSelected} key={player.id}/>)}</div>})}</div>:null}</div>{teams.some(team=>team.players.length===0)?<p className="empty-state">A starting XI has not been saved for this matchup yet.</p>:null}</section>
      <section className="panel matchup-bench-card"><div className="section-row"><div><p className="eyebrow">SQUAD DEPTH</p><h2>Bench performance</h2><small className="lineup-state">Points shown here are not included in the matchup total.</small></div><span className="muted-chip">BENCH</span></div><div className="bench-matchup-grid">{teams.map(team=><article className="team-bench" key={team.userId}><header><strong>{team.name}</strong><span>{team.bench.reduce((total,player)=>total+player.score,0)} bench pts</span></header><div className="bench-player-list">{team.bench.length?team.bench.map(player=><BenchPlayer player={player} onSelect={setSelected} key={player.id}/>):<p className="empty-state">No bench has been saved for this lineup.</p>}</div></article>)}</div></section>
      <section className="panel fixture-list"><div className="section-row"><div><h2>Gameweek {gameweek} fixtures</h2><small className="lineup-state">Open any matchup to view both Starting XIs, benches and scoring cards.</small></div><span className="muted-chip">{weekFixtures.length}</span></div>{weekFixtures.map(matchup=><button className={`fixture-row fixture-button${featured.id===matchup.id?" active":""}`} key={matchup.id} onClick={()=>{if(featured.id===matchup.id)return;setTeams([]);setSelectedMatchupId(matchup.id);setSelected(null);window.scrollTo({top:0,behavior:"smooth"})}} aria-label={`Open ${managers.find(manager=>manager.user_id===matchup.home_user_id)?.team_name??"home team"} versus ${managers.find(manager=>manager.user_id===matchup.away_user_id)?.team_name??"away team"}`} aria-current={featured.id===matchup.id?"true":undefined}><span>{managers.find(manager=>manager.user_id===matchup.home_user_id)?.team_name}</span><b>{matchup.status==="scheduled"?"VS":`${Number(matchup.home_score)}–${Number(matchup.away_score)}`}</b><span>{managers.find(manager=>manager.user_id===matchup.away_user_id)?.team_name}</span><i aria-hidden="true">›</i></button>)}</section>
      <section className="panel standings-result"><div className="section-row"><h2>League table</h2><span className="muted-chip">LIVE TABLE</span></div><div className="standings-head"><span>#</span><span>Team</span><span>P</span><span>W-D-L</span><span>Pts</span><span>FP</span></div>{standings.map(row=><div className="standing-row" key={row.user_id}><span>{row.rank}</span><strong>{row.team_name}</strong><span>{row.played}</span><span>{row.wins}-{row.draws}-{row.losses}</span><b>{row.points}</b><span>{Number(row.fantasy_points)}</span></div>)}</section>
    </>:null}
    {selected?<MatchupPlayerDialog player={selected} gameweek={gameweek} lastUpdated={lastUpdated} onClose={()=>setSelected(null)}/>:null}
  </PageShell>;
}
