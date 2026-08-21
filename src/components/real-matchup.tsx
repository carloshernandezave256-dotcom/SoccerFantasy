"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageShell } from "./page-shell";
import { supabase } from "@/lib/supabase";
import { calculateScore, type LedgerEntry, type PlayerMatchStats, type Position } from "@/lib/scoring";
import { resolveActiveLeague } from "@/lib/active-league";
import { PlayerHeadshot } from "./player-headshot";

type League={league_id:string;league_name:string;team_name:string;game_format:string};
type Manager={draft_slot:number;user_id:string;team_name:string};
type Matchup={id:string;gameweek:number;home_user_id:string;away_user_id:string;home_score:number|string;away_score:number|string;status:"scheduled"|"live"|"final"};
type Player={id:number;full_name:string;position:string;club:string;photo_url?:string|null;starPick?:boolean;score:number;rating:number|null;manOfTheMatch:boolean;status:"not_started"|"live"|"final";ledger:LedgerEntry[]};
type TeamView={userId:string;name:string;score:number;players:Player[];lineupSet:boolean};
type ScoreRow={player_id:number;rating:number|null;minutes:number;goals:number;assists:number;shots_on_target:number;big_chances_missed:number;completed_passes:number;tackles_won:number;penalty_goals:number;penalties_missed:number;penalties_conceded:number;saves:number;penalties_saved:number;goals_conceded:number;yellow_cards:number;second_yellow_cards:number;red_cards:number;own_goals:number;man_of_the_match:boolean;status:"not_started"|"live"|"final"};
type Standing={rank:number;user_id:string;team_name:string;played:number;wins:number;draws:number;losses:number;points:number;fantasy_points:number|string};

const positionOrder:Record<string,number>={GK:0,DEF:1,MID:2,FWD:3};

export function RealMatchup(){
  const[league,setLeague]=useState<League|null>(null);
  const[userId,setUserId]=useState<string|null>(null);
  const[managers,setManagers]=useState<Manager[]>([]);
  const[matchups,setMatchups]=useState<Matchup[]>([]);
  const[gameweek,setGameweek]=useState(1);
  const[teams,setTeams]=useState<TeamView[]>([]);
  const[standings,setStandings]=useState<Standing[]>([]);
  const[activeTeam,setActiveTeam]=useState(0);
  const[selected,setSelected]=useState<Player|null>(null);
  const[loading,setLoading]=useState(true);
  const[message,setMessage]=useState("");

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
    const activeWeek=scoredWeek||windowWeek||(Number.isFinite(firstScheduledWeek)?firstScheduledWeek:1);
    setGameweek(activeWeek);
    await supabase.rpc("refresh_league_matchup_scores",{p_league_id:active.league_id,p_gameweek:activeWeek});
    setManagers((orderResult.data??[]) as Manager[]);
    setMatchups(loadedMatchups);
    setLoading(false);
  },[]);

  useEffect(()=>{void load()},[load]);

  const weekFixtures=useMemo(()=>matchups.filter(matchup=>matchup.gameweek===gameweek),[matchups,gameweek]);
  const featured=useMemo(()=>weekFixtures.find(matchup=>matchup.home_user_id===userId||matchup.away_user_id===userId)??weekFixtures[0]??null,[weekFixtures,userId]);
  const maxWeek=Math.max(1,...matchups.map(matchup=>matchup.gameweek));

  useEffect(()=>{
    if(!featured||!league)return;
    void(async()=>{
      setLoading(true);
      const ids=[featured.home_user_id,featured.away_user_id];
      await supabase.rpc("refresh_league_matchup_scores",{p_league_id:league.league_id,p_gameweek:gameweek});
      const[lineupResult,snapshotResult,picksResult,scoreResult,matchupResult,standingsResult]=await Promise.all([
        supabase.from("lineup_players").select("user_id,is_starter,is_captain,players(id,full_name,position,club,photo_url)").eq("league_id",league.league_id).in("user_id",ids),
        supabase.from("lineup_gameweek_players").select("user_id,is_starter,is_star_pick,players(id,full_name,position,club,photo_url)").eq("league_id",league.league_id).eq("gameweek",gameweek).in("user_id",ids),
        supabase.from("draft_picks").select("user_id,pick_number,players(id,full_name,position,club,photo_url)").eq("league_id",league.league_id).in("user_id",ids).order("pick_number"),
        supabase.from("league_player_scores").select("player_id,rating,minutes,goals,assists,shots_on_target,big_chances_missed,completed_passes,tackles_won,penalty_goals,penalties_missed,penalties_conceded,saves,penalties_saved,goals_conceded,yellow_cards,second_yellow_cards,red_cards,own_goals,man_of_the_match,status").eq("league_id",league.league_id).eq("gameweek",gameweek),
        supabase.from("league_matchups").select("home_score,away_score,status").eq("id",featured.id).single(),
        supabase.rpc("league_standings",{p_league_id:league.league_id}),
      ]);
      const lineupRows=(lineupResult.data??[]) as unknown as {user_id:string;is_starter:boolean;is_captain:boolean;players:Omit<Player,"score"|"rating"|"manOfTheMatch"|"status"|"ledger">|null}[];
      const snapshotRows=(snapshotResult.data??[]) as unknown as {user_id:string;is_starter:boolean;is_star_pick:boolean;players:Omit<Player,"score"|"rating"|"manOfTheMatch"|"status"|"ledger">|null}[];
      const pickRows=(picksResult.data??[]) as unknown as {user_id:string;pick_number:number;players:Omit<Player,"score"|"rating"|"manOfTheMatch"|"status"|"ledger">|null}[];
      const scoreRows=(scoreResult.data??[]) as ScoreRow[];
      const liveMatchup=matchupResult.data as {home_score:number|string;away_score:number|string;status:Matchup["status"]}|null;
      if(liveMatchup&&(Number(liveMatchup.home_score)!==Number(featured.home_score)||Number(liveMatchup.away_score)!==Number(featured.away_score)||liveMatchup.status!==featured.status)){
        setMatchups(current=>current.map(matchup=>matchup.id===featured.id?{...matchup,...liveMatchup}:matchup));
      }
      const scoredPlayer=(player:Omit<Player,"score"|"rating"|"manOfTheMatch"|"status"|"ledger">,starPick:boolean,lineupSet:boolean):Player=>{
        const row=scoreRows.find(score=>score.player_id===player.id);
        if(!row||!lineupSet)return{...player,starPick,score:0,rating:null,manOfTheMatch:false,status:"not_started",ledger:[]};
        const stats:PlayerMatchStats={position:player.position as Position,minutes:row.minutes,goals:row.goals,assists:row.assists,shotsOnTarget:row.shots_on_target,completedPasses:row.completed_passes,tacklesWon:row.tackles_won,penaltyGoals:row.penalty_goals,penaltiesMissed:row.penalties_missed,penaltiesConceded:row.penalties_conceded,saves:row.saves,penaltiesSaved:row.penalties_saved,goalsConceded:row.goals_conceded,yellowCards:row.yellow_cards,secondYellowCards:row.second_yellow_cards,redCards:row.red_cards,ownGoals:row.own_goals};
        const result=calculateScore(stats);
        return{...player,starPick,score:result.total,rating:row.rating,manOfTheMatch:row.man_of_the_match,status:row.status,ledger:result.entries};
      };
      const build=(owner:string,score:number|string):TeamView=>{
        const snapshot=snapshotRows.filter(row=>row.user_id===owner&&row.is_starter&&row.players).map(row=>({...row,is_captain:row.is_star_pick}));
        const saved=snapshot.length?snapshot:lineupRows.filter(row=>row.user_id===owner&&row.is_starter&&row.players);
        let source=saved.length?saved.map(row=>scoredPlayer(row.players!,row.is_captain,true)):pickRows.filter(row=>row.user_id===owner&&row.players).slice(0,11).map(row=>scoredPlayer(row.players!,false,false));
        if(saved.length&&(liveMatchup?.status??featured.status)==="final"){
          const highest=Math.max(...source.map(player=>player.score));
          source=source.map(player=>player.starPick&&player.score===highest?{...player,score:player.score+5,ledger:[...player.ledger,{code:"star-pick",label:"Star Pick",detail:"Your prediction finished as your highest-scoring starter",points:5}]}:player);
        }
        return{userId:owner,name:managers.find(manager=>manager.user_id===owner)?.team_name??"Manager",score:Number(score),players:source.sort((a,b)=>(positionOrder[a.position]??9)-(positionOrder[b.position]??9)),lineupSet:saved.length>0};
      };
      setTeams([build(featured.home_user_id,liveMatchup?.home_score??featured.home_score),build(featured.away_user_id,liveMatchup?.away_score??featured.away_score)]);
      setStandings((standingsResult.data??[]) as Standing[]);
      setActiveTeam(0);setLoading(false);
    })();
  },[featured,league,managers,gameweek]);

  return <PageShell eyebrow={league?.league_name??"LEAGUE MATCHUPS"} title="Head to head">
    <div className="gameweek-picker"><button disabled={gameweek===1} onClick={()=>setGameweek(week=>week-1)}>←</button><label>Gameweek<select value={gameweek} onChange={event=>setGameweek(Number(event.target.value))}>{Array.from({length:maxWeek},(_,index)=>index+1).map(week=><option key={week}>{week}</option>)}</select></label><button disabled={gameweek===maxWeek} onClick={()=>setGameweek(week=>week+1)}>→</button></div>
    {loading&&teams.length===0?<section className="panel empty-state">Loading the league schedule…</section>:null}
    {message?<section className="panel empty-state">{message}</section>:null}
    {featured&&teams.length===2?<>
      <section className="match-card gameweek-score real-score">
        <span className="simulation-chip">{featured.status==="final"?"FINAL":featured.status==="live"?"LIVE":"SCHEDULED"}</span>
        <div className="versus"><div><strong>{teams[0].score}</strong><span>{teams[0].name}</span></div><div className="versus-mark">VS</div><div><strong>{teams[1].score}</strong><span>{teams[1].name}</span></div></div>
        <div className="progress"><span style={{width:teams[0].score+teams[1].score>0?`${teams[0].score/(teams[0].score+teams[1].score)*100}%`:"50%"}}/></div>
        <div className="match-status"><span className="live-dot"/> {featured.status==="scheduled"?"Scores begin when live match data is connected":featured.status==="live"?"Scoring in progress":"Matchup complete"}</div>
      </section>
      <div className="segmented team-tabs" aria-label="Matchup teams">{teams.map((team,index)=><button key={team.userId} className={activeTeam===index?"active":""} onClick={()=>setActiveTeam(index)}>{team.name}<b>{team.score}</b></button>)}</div>
      <div className="matchup-lineups">{teams.map((team,teamIndex)=><section className={`panel matchup-team ${activeTeam===teamIndex?"active":""}`} key={team.userId}><div className="section-row"><div><h2>{team.name}</h2><small className="lineup-state">{team.lineupSet?"Saved starting XI":"Squad preview · lineup not set"}</small></div><strong className="team-total">{team.score} pts</strong></div>{team.players.map(player=><button className="scored-player" key={player.id} onClick={()=>setSelected(player)}><PlayerHeadshot name={player.full_name} position={player.position} photoUrl={player.photo_url}/><span><strong>{player.full_name}{player.starPick?<em className="captain-badge" title="Star Pick">★</em>:null}</strong><small>{player.club} · {player.status==="live"?"Live":player.status==="final"?"Final":"Not started"}</small></span><b className={player.score<0?"negative":"positive"}>{player.score}</b><i>›</i></button>)}{team.players.length===0?<p className="empty-state">This manager has not drafted any players yet.</p>:null}</section>)}</div>
      <section className="panel fixture-list"><div className="section-row"><h2>Gameweek {gameweek} fixtures</h2><span className="muted-chip">{weekFixtures.length}</span></div>{weekFixtures.map(matchup=><div className="fixture-row" key={matchup.id}><span>{managers.find(manager=>manager.user_id===matchup.home_user_id)?.team_name}</span><b>{Number(matchup.home_score)}–{Number(matchup.away_score)}</b><span>{managers.find(manager=>manager.user_id===matchup.away_user_id)?.team_name}</span></div>)}</section>
      <section className="panel standings-result"><div className="section-row"><h2>League table</h2><span className="muted-chip">LIVE TABLE</span></div><div className="standings-head"><span>#</span><span>Team</span><span>P</span><span>W-D-L</span><span>Pts</span><span>FP</span></div>{standings.map(row=><div className="standing-row" key={row.user_id}><span>{row.rank}</span><strong>{row.team_name}</strong><span>{row.played}</span><span>{row.wins}-{row.draws}-{row.losses}</span><b>{row.points}</b><span>{Number(row.fantasy_points)}</span></div>)}</section>
    </>:null}
    {selected?<div className="confirm-overlay ledger-overlay" role="presentation" onClick={()=>setSelected(null)}><section className="confirm-card player-ledger" role="dialog" aria-modal="true" onClick={event=>event.stopPropagation()}><button className="ledger-close" onClick={()=>setSelected(null)}>×</button><span className={`position ${selected.position.toLowerCase()}`}>{selected.position}</span><p className="eyebrow">SCORING BREAKDOWN</p><h2>{selected.full_name}</h2><p>{selected.club}{selected.starPick?" · Star Pick":""}</p>{selected.rating!==null||selected.manOfTheMatch?<div className="match-award-summary"><span><small>API MATCH RATING</small><strong>{selected.rating!==null?selected.rating.toFixed(1):"—"}</strong></span>{selected.manOfTheMatch?<span className="motm-award"><img src="/motm-badge.png" alt="Man of the Match trophy"/><b>Man of the Match</b></span>:null}</div>:null}<div className="ledger-total"><span>Fantasy points</span><strong>{selected.score}</strong></div>{selected.ledger.length?<><div className="ledger">{selected.ledger.map(entry=><div key={entry.code}><span><strong>{entry.label}</strong><small>{entry.detail}</small></span><b className={entry.points<0?"negative":"positive"}>{entry.points>0?"+":""}{entry.points}</b></div>)}</div><div className="ledger-reconcile"><span>Ledger total</span><strong>{selected.score} pts</strong></div></>:<p className="empty-state">No match statistics have been recorded for this player yet. Their itemized ledger will populate automatically when scoring begins.</p>}</section></div>:null}
  </PageShell>;
}
