"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { supabase } from "@/lib/supabase";
import { resolveActiveLeague } from "@/lib/active-league";
import { calculateScore, type Position } from "@/lib/scoring";

type League = { league_id: string; league_name: string; team_name: string; is_commissioner: boolean; game_format?: string };
type Player = { id: number; full_name: string; position: string; club: string; competition: string; draft_rank?: number };
type Pick = { user_id: string; player_id: number; players: Player | null };
type Claim = { id: string; user_id: string; add_player_id: number; drop_player_id: number | null; status: string; created_at: string; processed_at: string | null; note: string | null };
type Priority = { rank: number; user_id: string; team_name: string };
type ScoreRow = { gameweek: number; player_id: number; minutes: number; goals: number; assists: number; shots_on_target: number; big_chances_missed: number; completed_passes: number; tackles_won: number; penalty_goals: number; penalties_missed: number; penalties_conceded: number; saves: number; penalties_saved: number; goals_conceded: number; yellow_cards: number; second_yellow_cards: number; red_cards: number; own_goals: number; man_of_the_match: boolean; status: string };
type PlayerTotals = { points: number; appearances: number; minutes: number; goals: number; assists: number; shotsOnTarget: number; completedPasses: number; tacklesWon: number; saves: number; cleanSheets: number; yellowCards: number; redCards: number; motm: number; gameweeks: { gameweek: number; points: number; status: string }[] };

export default function WaiversPage() {
  const [league, setLeague] = useState<League | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [priority, setPriority] = useState<Priority[]>([]);
  const [scores, setScores] = useState<ScoreRow[]>([]);
  const [userId, setUserId] = useState("");
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState("ALL");
  const [selected, setSelected] = useState<Player | null>(null);
  const [dropId, setDropId] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"market" | "claims">("market");
  const [marketFilter, setMarketFilter] = useState<"ALL" | "AVAILABLE" | "OWNED">("ALL");
  const [sort, setSort] = useState<"RANK" | "POINTS">("RANK");
  const [statsPlayer, setStatsPlayer] = useState<Player | null>(null);

  async function loadLeague(active: League, currentUser: string) {
    setLoading(true);
    const [playerResult, pickResult, claimResult, priorityResult, scoreResult] = await Promise.all([
      supabase.from("players").select("id,full_name,position,club,competition,draft_rank").eq("active", true).order("draft_rank").limit(1000),
      supabase.from("draft_picks").select("user_id,player_id,players(id,full_name,position,club,competition,draft_rank)").eq("league_id", active.league_id),
      supabase.from("waiver_claims").select("id,user_id,add_player_id,drop_player_id,status,created_at,processed_at,note").eq("league_id", active.league_id).order("created_at", { ascending: false }),
      supabase.rpc("waiver_priority", { p_league_id: active.league_id }),
      supabase.from("league_player_scores").select("gameweek,player_id,minutes,goals,assists,shots_on_target,big_chances_missed,completed_passes,tackles_won,penalty_goals,penalties_missed,penalties_conceded,saves,penalties_saved,goals_conceded,yellow_cards,second_yellow_cards,red_cards,own_goals,man_of_the_match,status").eq("league_id", active.league_id).order("gameweek", { ascending: false }),
    ]);
    const error = playerResult.error ?? pickResult.error ?? claimResult.error ?? priorityResult.error ?? scoreResult.error;
    if (error) setMessage(error.message);
    setPlayers((playerResult.data ?? []) as Player[]);
    setPicks((pickResult.data ?? []) as unknown as Pick[]);
    setClaims((claimResult.data ?? []) as Claim[]);
    setPriority((priorityResult.data ?? []) as Priority[]);
    setScores((scoreResult.data ?? []) as ScoreRow[]);
    setUserId(currentUser);
    setLoading(false);
  }

  useEffect(() => {
    setTab(window.location.hash === "#claims" ? "claims" : "market");
    const syncHash = () => setTab(window.location.hash === "#claims" ? "claims" : "market");
    window.addEventListener("hashchange", syncHash);
    async function start() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      const { data, error } = await supabase.rpc("my_leagues");
      if (error) { setMessage(error.message); setLoading(false); return; }
      const list = (data ?? []) as League[];
      const active = resolveActiveLeague(list, new URLSearchParams(window.location.search).get("league")) ?? null;
      if(active?.game_format==="pack"){window.location.replace(`/players?league=${active.league_id}`);return}
      setLeague(active); setUserId(user.id);
      if (active) await loadLeague(active, user.id); else setLoading(false);
    }
    void start();
    return () => window.removeEventListener("hashchange", syncHash);
  }, []);

  const ownedIds = useMemo(() => new Set(picks.map((pick) => pick.player_id)), [picks]);
  const roster = useMemo(() => picks.filter((pick) => pick.user_id === userId && pick.players).map((pick) => pick.players as Player).sort((a, b) => a.position.localeCompare(b.position)), [picks, userId]);
  const playerMap = useMemo(() => new Map(players.map((player) => [player.id, player])), [players]);
  const teamMap = useMemo(() => new Map(priority.map((item) => [item.user_id, item.team_name])), [priority]);
  const ownerByPlayer = useMemo(() => new Map(picks.map((pick) => [pick.player_id, teamMap.get(pick.user_id) ?? "Owned"])), [picks, teamMap]);
  const totalsByPlayer = useMemo(() => {
    const totals = new Map<number, PlayerTotals>();
    for (const row of scores) {
      const player = playerMap.get(row.player_id);
      if (!player) continue;
      const points = calculateScore({ position: player.position as Position, minutes: row.minutes, goals: row.goals, assists: row.assists, shotsOnTarget: row.shots_on_target, bigChancesMissed: row.big_chances_missed, completedPasses: row.completed_passes, tacklesWon: row.tackles_won, penaltyGoals: row.penalty_goals, penaltiesMissed: row.penalties_missed, penaltiesConceded: row.penalties_conceded, saves: row.saves, penaltiesSaved: row.penalties_saved, goalsConceded: row.goals_conceded, yellowCards: row.yellow_cards, secondYellowCards: row.second_yellow_cards, redCards: row.red_cards, ownGoals: row.own_goals, manOfTheMatch: row.man_of_the_match }).total;
      const current = totals.get(row.player_id) ?? { points: 0, appearances: 0, minutes: 0, goals: 0, assists: 0, shotsOnTarget: 0, completedPasses: 0, tacklesWon: 0, saves: 0, cleanSheets: 0, yellowCards: 0, redCards: 0, motm: 0, gameweeks: [] };
      current.points += points;
      current.appearances += row.minutes > 0 ? 1 : 0;
      current.minutes += row.minutes;
      current.goals += row.goals;
      current.assists += row.assists;
      current.shotsOnTarget += row.shots_on_target;
      current.completedPasses += row.completed_passes;
      current.tacklesWon += row.tackles_won;
      current.saves += row.saves;
      current.cleanSheets += row.minutes >= 60 && row.goals_conceded === 0 && (player.position === "GK" || player.position === "DEF") ? 1 : 0;
      current.yellowCards += row.yellow_cards;
      current.redCards += row.red_cards + row.second_yellow_cards;
      current.motm += row.man_of_the_match ? 1 : 0;
      current.gameweeks.push({ gameweek: row.gameweek, points, status: row.status });
      totals.set(row.player_id, current);
    }
    return totals;
  }, [scores, playerMap]);
  const emptyTotals: PlayerTotals = { points: 0, appearances: 0, minutes: 0, goals: 0, assists: 0, shotsOnTarget: 0, completedPasses: 0, tacklesWon: 0, saves: 0, cleanSheets: 0, yellowCards: 0, redCards: 0, motm: 0, gameweeks: [] };
  const marketPlayers = useMemo(() => players.filter((player) => {
    const search = query.trim().toLowerCase();
    const isOwned = ownedIds.has(player.id);
    return (marketFilter === "ALL" || (marketFilter === "AVAILABLE" && !isOwned) || (marketFilter === "OWNED" && isOwned)) && (position === "ALL" || player.position === position) && (!search || `${player.full_name} ${player.club} ${player.competition}`.toLowerCase().includes(search));
  }).sort((a, b) => sort === "POINTS" ? (totalsByPlayer.get(b.id)?.points ?? 0) - (totalsByPlayer.get(a.id)?.points ?? 0) || (a.draft_rank ?? 9999) - (b.draft_rank ?? 9999) : (a.draft_rank ?? 9999) - (b.draft_rank ?? 9999)), [players, ownedIds, query, position, marketFilter, sort, totalsByPlayer]);

  async function submitClaim() {
    if (!league || !selected || !dropId) return;
    setBusy(true); setMessage("");
    const { error } = await supabase.rpc("submit_waiver_claim", { p_league_id: league.league_id, p_add_player_id: selected.id, p_drop_player_id: Number(dropId) });
    if (error) setMessage(error.message); else { setMessage(`Claim submitted for ${selected.full_name}.`); setSelected(null); setDropId(""); await loadLeague(league, userId); }
    setBusy(false);
  }

  async function cancelClaim(id: string) {
    if (!league) return;
    setBusy(true); setMessage("");
    const { error } = await supabase.rpc("cancel_waiver_claim", { p_claim_id: id });
    if (error) setMessage(error.message); else { setMessage("Claim cancelled."); await loadLeague(league, userId); }
    setBusy(false);
  }

  async function processClaims() {
    if (!league) return;
    setBusy(true); setMessage("");
    const { data, error } = await supabase.rpc("process_waivers", { p_league_id: league.league_id });
    if (error) setMessage(error.message); else { setMessage(`${data ?? 0} waiver claim${data === 1 ? "" : "s"} completed.`); await loadLeague(league, userId); }
    setBusy(false);
  }

  return <PageShell eyebrow="ROSTER MOVES" title="Player market">
    <nav className="player-market-tabs two-tabs" aria-label="Player market sections"><button className={tab === "market" ? "active" : ""} onClick={() => { setTab("market"); window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}#market`); }}>Player market</button><button className={tab === "claims" ? "active" : ""} onClick={() => { setTab("claims"); window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}#claims`); }}>My claims</button></nav>
    {!userId && !loading ? <section className="panel empty-feature"><span>↻</span><h2>Sign in to manage waivers</h2><p>Your claims, roster, and waiver priority are private to your league.</p><Link className="primary-button" href="/login?next=/waivers">Log in</Link></section> : !league && !loading ? <section className="panel empty-feature"><span>＋</span><h2>Join a league first</h2><p>Waivers open for managers after a league draft is complete.</p><Link className="primary-button" href="/league">Open leagues</Link></section> : <>
      <section className="waiver-summary"><div><small>YOUR PRIORITY</small><strong>#{priority.find((item) => item.user_id === userId)?.rank ?? "—"}</strong></div><div><small>YOUR ROSTER</small><strong>{roster.length}/18</strong></div><div><small>PENDING</small><strong>{claims.filter((claim) => claim.user_id === userId && claim.status === "pending").length}</strong></div></section>
      {message ? <p className="panel waiver-message">{message}</p> : null}
      {tab === "market" ? <section className="panel">
        <div className="section-row"><div><h2>Player market</h2><small>Showing {Math.min(marketPlayers.length, 60)} of {marketPlayers.length}</small></div><label className="market-sort">Sort<select value={sort} onChange={(event) => setSort(event.target.value as "RANK" | "POINTS")}><option value="RANK">Player rank</option><option value="POINTS">Fantasy points</option></select></label></div>
        <div className="market-status-filter">{(["ALL", "AVAILABLE", "OWNED"] as const).map((item) => <button key={item} className={marketFilter === item ? "active" : ""} onClick={() => setMarketFilter(item)}>{item}</button>)}</div>
        <div className="search-box"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search player, club, or league" /></div>
        <div className="filter-row">{["ALL", "GK", "DEF", "MID", "FWD"].map((item) => <button key={item} className={position === item ? "active" : ""} onClick={() => setPosition(item)}>{item}</button>)}</div>
        <div className="player-list waiver-player-list">{marketPlayers.slice(0, 60).map((player) => { const owner = ownerByPlayer.get(player.id); const totals = totalsByPlayer.get(player.id) ?? emptyTotals; return <article key={player.id} role="button" tabIndex={0} onClick={() => setStatsPlayer(player)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setStatsPlayer(player); }}><span className={`position ${player.position.toLowerCase()}`}>{player.position}</span><div><strong>{player.full_name}</strong><small>#{player.draft_rank ?? "—"} · {player.club} · {player.competition}</small>{owner ? <small className="ownership-label">Owned by {owner}</small> : <small className="available-label">Available · tap for stats</small>}</div><b className="fantasy-points-chip">{totals.points} FP</b>{owner ? <span className="owned-chip">OWNED</span> : <button className="claim-button" onClick={(event) => { event.stopPropagation(); setSelected(player); setDropId(""); }}>CLAIM</button>}</article>; })}{!loading && marketPlayers.length === 0 ? <p className="empty-state">No players match those filters.</p> : null}</div>
      </section> : <><section className="panel waiver-priority"><div className="section-row"><h2>Waiver priority</h2>{league?.is_commissioner ? <button className="process-button" onClick={() => void processClaims()} disabled={busy || !claims.some((claim) => claim.status === "pending")}>Process claims</button> : null}</div>{priority.map((item) => <article key={item.user_id} className={item.user_id === userId ? "you" : ""}><span>{item.rank}</span><strong>{item.team_name}</strong>{item.user_id === userId ? <small>YOU</small> : null}</article>)}</section><section className="panel claim-history"><div className="section-row"><h2>Claim history</h2><span className="muted-chip">{claims.length}</span></div>{claims.length === 0 ? <p className="empty-state">No waiver claims yet.</p> : claims.map((claim) => { const add = playerMap.get(claim.add_player_id); const drop = claim.drop_player_id ? playerMap.get(claim.drop_player_id) : null; return <article key={claim.id}><div><span className={`claim-status ${claim.status}`}>{claim.status}</span><strong>{teamMap.get(claim.user_id) ?? "Your team"}: {add?.full_name ?? "Player"}</strong><small>{drop ? `Drop ${drop.full_name} · ` : ""}{new Date(claim.created_at).toLocaleString()}{claim.note ? ` · ${claim.note}` : ""}</small></div>{claim.user_id === userId && claim.status === "pending" ? <button onClick={() => void cancelClaim(claim.id)} disabled={busy}>Cancel</button> : null}</article>; })}</section></>}
    </>}
    {selected ? <div className="waiver-overlay" role="dialog" aria-modal="true" aria-label="Submit waiver claim"><section className="panel waiver-dialog"><p className="eyebrow">WAIVER CLAIM</p><h2>Add {selected.full_name}</h2><p>Select the player who will leave your 18-player roster if this claim succeeds.</p><label>Drop from your roster<select value={dropId} onChange={(event) => setDropId(event.target.value)}><option value="">Choose a player</option>{roster.map((player) => <option key={player.id} value={player.id}>{player.position} · {player.full_name}</option>)}</select></label><div><button className="secondary-button" onClick={() => setSelected(null)} disabled={busy}>Back</button><button className="primary-button" onClick={() => void submitClaim()} disabled={busy || !dropId}>{busy ? "Submitting…" : "Submit claim"}</button></div></section></div> : null}
    {statsPlayer ? (() => { const totals = totalsByPlayer.get(statsPlayer.id) ?? emptyTotals; return <div className="waiver-overlay stats-overlay" role="dialog" aria-modal="true" aria-label={`${statsPlayer.full_name} statistics`} onClick={() => setStatsPlayer(null)}><section className="panel player-stats-dialog" onClick={(event) => event.stopPropagation()}><button className="stats-close" onClick={() => setStatsPlayer(null)} aria-label="Close player statistics">×</button><p className="eyebrow">PLAYER PROFILE</p><h2>{statsPlayer.full_name}</h2><p>{statsPlayer.position} · {statsPlayer.club} · {statsPlayer.competition}</p><div className="stats-hero"><strong>{totals.points}</strong><span>FANTASY POINTS</span></div><div className="stats-grid"><div><b>{totals.appearances}</b><small>Apps</small></div><div><b>{totals.minutes}</b><small>Minutes</small></div><div><b>{totals.goals}</b><small>Goals</small></div><div><b>{totals.assists}</b><small>Assists</small></div><div><b>{totals.shotsOnTarget}</b><small>Shots on target</small></div><div><b>{totals.tacklesWon}</b><small>Tackles won</small></div><div><b>{totals.completedPasses}</b><small>Passes</small></div><div><b>{statsPlayer.position === "GK" ? totals.saves : totals.cleanSheets}</b><small>{statsPlayer.position === "GK" ? "Saves" : "Clean sheets"}</small></div></div><div className="gameweek-stats"><h3>Gameweek points</h3>{totals.gameweeks.length ? totals.gameweeks.map((week) => <div key={week.gameweek}><span>GW {week.gameweek}</span><small>{week.status.replace("_", " ")}</small><b>{week.points} FP</b></div>) : <p>No match statistics have been recorded yet.</p>}</div></section></div>; })() : null}
  </PageShell>;
}
