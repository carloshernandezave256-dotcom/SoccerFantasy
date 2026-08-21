"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { supabase } from "@/lib/supabase";
import { loadActivePlayerPool } from "@/lib/active-player-pool";
import { resolveActiveLeague } from "@/lib/active-league";
import { PlayerHeadshot } from "@/components/player-headshot";
import { PlayerStatsDialog } from "@/components/player-stats-dialog";

type League = { league_id: string; league_name: string; team_name: string; is_commissioner: boolean; game_format?: string; player_pool?: string };
type Player = { id: number; full_name: string; position: string; club: string; competition: string; draft_rank?: number; photo_url?:string|null; injured?:boolean; injury_type?:string|null; injury_reason?:string|null; expected_return?:string|null };
type Pick = { user_id: string; player_id: number; players: Player | null };
type Claim = { id: string; user_id: string; add_player_id: number; drop_player_id: number | null; gameweek:number; claim_rank:number; status: string; created_at: string; processed_at: string | null; note: string | null };
type ContractOffer = { id:string;user_id:string;add_player_id:number;release_player_id:number;gameweek:number;offer_rank:number;amount:number;status:string;created_at:string;processed_at:string|null;note:string|null };
type Priority = { rank: number; user_id: string; team_name: string };
type TransactionWindow={gameweek:number;waiver_process_at:string;roster_lock_at:string;phase:"waivers"|"free_agency"|"locked"};
type SeasonTotal = { player_id:number;points:number;appearances:number;minutes:number;goals:number;assists:number;shots_on_target:number;completed_passes:number;tackles_won:number;saves:number;clean_sheets:number;yellow_cards:number;red_cards:number;motm:number;latest_gameweek:number|null;latest_status:string|null };
type PlayerTotals = { points: number; appearances: number; minutes: number; goals: number; assists: number; shotsOnTarget: number; completedPasses: number; tacklesWon: number; saves: number; cleanSheets: number; yellowCards: number; redCards: number; motm: number; gameweeks: { gameweek: number; points: number; status: string }[] };
type WatchRow={player_id:number};

export default function WaiversPage() {
  const [league, setLeague] = useState<League | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [contractOffers,setContractOffers]=useState<ContractOffer[]>([]);
  const [contractBudget,setContractBudget]=useState(0);
  const [priority, setPriority] = useState<Priority[]>([]);
  const [seasonTotals, setSeasonTotals] = useState<SeasonTotal[]>([]);
  const [watchlist,setWatchlist]=useState<Set<number>>(new Set());
  const [userId, setUserId] = useState("");
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState("ALL");
  const [selected, setSelected] = useState<Player | null>(null);
  const [dropId, setDropId] = useState("");
  const [offerAmount,setOfferAmount]=useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"market" | "claims">("market");
  const [marketFilter, setMarketFilter] = useState<"ALL" | "AVAILABLE" | "WATCHLIST">("ALL");
  const [sort, setSort] = useState<"RANK" | "POINTS">("RANK");
  const [statsPlayer, setStatsPlayer] = useState<Player | null>(null);
  const [windowState,setWindowState]=useState<TransactionWindow|null>(null);

  async function loadLeague(active: League, currentUser: string) {
    setLoading(true);
    const [playerResult, pickResult, claimResult, priorityResult, scoreResult,windowResult,offerResult,budgetResult,watchResult] = await Promise.all([
      loadActivePlayerPool(active.player_pool),
      supabase.from("draft_picks").select("user_id,player_id,players(id,full_name,position,club,competition,draft_rank,photo_url,injured,injury_type,injury_reason,expected_return)").eq("league_id", active.league_id),
      supabase.from("waiver_claims").select("id,user_id,add_player_id,drop_player_id,gameweek,claim_rank,status,created_at,processed_at,note").eq("league_id", active.league_id).order("created_at", { ascending: false }),
      supabase.rpc("waiver_priority", { p_league_id: active.league_id }),
      supabase.rpc("player_season_totals"),
      supabase.rpc("transaction_window",{p_league_id:active.league_id}),
      supabase.from("auction_contract_offers").select("id,user_id,add_player_id,release_player_id,gameweek,offer_rank,amount,status,created_at,processed_at,note").eq("league_id",active.league_id).order("created_at",{ascending:false}),
      supabase.from("auction_budgets").select("remaining_budget").eq("league_id",active.league_id).eq("user_id",currentUser).maybeSingle(),
      supabase.from("player_watchlists").select("player_id").eq("league_id",active.league_id).eq("user_id",currentUser),
    ]);
    const error = playerResult.error ?? pickResult.error ?? claimResult.error ?? priorityResult.error ?? scoreResult.error??windowResult.error??offerResult.error??budgetResult.error??watchResult.error;
    if (error) setMessage(error.message);
    setPlayers(((playerResult.data ?? []) as Player[]).filter(player=>!active.player_pool||active.player_pool==="All Top Five"||player.competition===active.player_pool));
    setPicks((pickResult.data ?? []) as unknown as Pick[]);
    setClaims((claimResult.data ?? []) as Claim[]);
    setPriority((priorityResult.data ?? []) as Priority[]);
    setSeasonTotals((scoreResult.data ?? []) as SeasonTotal[]);
    setWindowState(((windowResult.data??[])[0] as TransactionWindow)??null);
    setContractOffers((offerResult.data??[]) as ContractOffer[]);
    setContractBudget(Number(budgetResult.data?.remaining_budget??0));
    setWatchlist(new Set(((watchResult.data??[]) as WatchRow[]).map(row=>row.player_id)));
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
  const isAuction=league?.game_format==="auction";
  const roster = useMemo(() => picks.filter((pick) => pick.user_id === userId && pick.players).map((pick) => pick.players as Player).sort((a, b) => a.position.localeCompare(b.position)), [picks, userId]);
  const playerMap = useMemo(() => new Map(players.map((player) => [player.id, player])), [players]);
  const teamMap = useMemo(() => new Map(priority.map((item) => [item.user_id, item.team_name])), [priority]);
  const ownerByPlayer = useMemo(() => new Map(picks.map((pick) => [pick.player_id, teamMap.get(pick.user_id) ?? "Owned"])), [picks, teamMap]);
  const totalsByPlayer = useMemo(() => new Map(seasonTotals.map((row):[number,PlayerTotals] => [row.player_id,{points:Number(row.points),appearances:Number(row.appearances),minutes:Number(row.minutes),goals:Number(row.goals),assists:Number(row.assists),shotsOnTarget:Number(row.shots_on_target),completedPasses:Number(row.completed_passes),tacklesWon:Number(row.tackles_won),saves:Number(row.saves),cleanSheets:Number(row.clean_sheets),yellowCards:Number(row.yellow_cards),redCards:Number(row.red_cards),motm:Number(row.motm),gameweeks:[]} ])),[seasonTotals]);
  const emptyTotals: PlayerTotals = { points: 0, appearances: 0, minutes: 0, goals: 0, assists: 0, shotsOnTarget: 0, completedPasses: 0, tacklesWon: 0, saves: 0, cleanSheets: 0, yellowCards: 0, redCards: 0, motm: 0, gameweeks: [] };
  const marketPlayers = useMemo(() => players.filter((player) => {
    const search = query.trim().toLowerCase();
    const isOwned = ownedIds.has(player.id);
    return (marketFilter === "ALL" || (marketFilter === "AVAILABLE" && !isOwned) || (marketFilter === "WATCHLIST" && watchlist.has(player.id))) && (position === "ALL" || player.position === position) && (!search || `${player.full_name} ${player.club} ${player.competition}`.toLowerCase().includes(search));
  }).sort((a, b) => sort === "POINTS" ? (totalsByPlayer.get(b.id)?.points ?? 0) - (totalsByPlayer.get(a.id)?.points ?? 0) || (a.draft_rank ?? 9999) - (b.draft_rank ?? 9999) : (a.draft_rank ?? 9999) - (b.draft_rank ?? 9999)), [players, ownedIds, watchlist, query, position, marketFilter, sort, totalsByPlayer]);

  async function toggleWatchlist(playerId:number){
    if(!league||!userId)return;
    const alreadyWatching=watchlist.has(playerId);
    setWatchlist(current=>{const next=new Set(current);if(alreadyWatching)next.delete(playerId);else next.add(playerId);return next});
    const result=alreadyWatching
      ?await supabase.from("player_watchlists").delete().eq("league_id",league.league_id).eq("user_id",userId).eq("player_id",playerId)
      :await supabase.from("player_watchlists").insert({league_id:league.league_id,user_id:userId,player_id:playerId});
    if(result.error){
      setWatchlist(current=>{const next=new Set(current);if(alreadyWatching)next.add(playerId);else next.delete(playerId);return next});
      setMessage(result.error.message);
    }
  }

  async function submitClaim() {
    if (!league || !selected || !dropId) return;
    setBusy(true); setMessage("");
    const amount=Math.round(Number(offerAmount)*1000000);
    const rpc=isAuction?"submit_contract_offer":windowState?.phase==="free_agency"?"pickup_free_agent":"submit_waiver_claim";
    const params=isAuction?{p_league_id:league.league_id,p_add_player_id:selected.id,p_release_player_id:Number(dropId),p_amount:amount}:{p_league_id:league.league_id,p_add_player_id:selected.id,p_drop_player_id:Number(dropId)};
    const { error } = await supabase.rpc(rpc, params);
    if (error) setMessage(error.message); else { setMessage(isAuction?`Blind contract offer submitted for ${selected.full_name}.`:(windowState?.phase==="free_agency"?`${selected.full_name} was added to your roster.`:`Claim submitted for ${selected.full_name}.`)); setSelected(null); setDropId("");setOfferAmount(""); await loadLeague(league, userId); }
    setBusy(false);
  }

  async function cancelContractOffer(id:string){
    if(!league)return;setBusy(true);setMessage("");const{error}=await supabase.rpc("cancel_contract_offer",{p_offer_id:id});if(error)setMessage(error.message);else{setMessage("Contract offer cancelled.");await loadLeague(league,userId)}setBusy(false)
  }

  async function moveContractOffer(id:string,direction:-1|1){
    if(!league)return;const pending=contractOffers.filter(offer=>offer.status==="pending").sort((a,b)=>a.offer_rank-b.offer_rank);const index=pending.findIndex(offer=>offer.id===id),target=index+direction;if(index<0||target<0||target>=pending.length)return;[pending[index],pending[target]]=[pending[target],pending[index]];setBusy(true);const{error}=await supabase.rpc("reorder_contract_offers",{p_league_id:league.league_id,p_offer_ids:pending.map(offer=>offer.id)});if(error)setMessage(error.message);else await loadLeague(league,userId);setBusy(false)
  }

  async function cancelClaim(id: string) {
    if (!league) return;
    setBusy(true); setMessage("");
    const { error } = await supabase.rpc("cancel_waiver_claim", { p_claim_id: id });
    if (error) setMessage(error.message); else { setMessage("Claim cancelled."); await loadLeague(league, userId); }
    setBusy(false);
  }

  async function moveClaim(id:string,direction:-1|1){
    if(!league)return;const pending=claims.filter(claim=>claim.user_id===userId&&claim.status==="pending").sort((a,b)=>a.claim_rank-b.claim_rank);const index=pending.findIndex(claim=>claim.id===id),target=index+direction;if(index<0||target<0||target>=pending.length)return;[pending[index],pending[target]]=[pending[target],pending[index]];setBusy(true);const{error}=await supabase.rpc("reorder_waiver_claims",{p_league_id:league.league_id,p_claim_ids:pending.map(claim=>claim.id)});if(error)setMessage(error.message);else await loadLeague(league,userId);setBusy(false)
  }

  return <PageShell eyebrow={isAuction?"AUCTION CONTRACTS":"ROSTER MOVES"} title={isAuction?"Contract market":"Player market"}>
    <nav className="player-market-tabs two-tabs" aria-label="Player market sections"><button className={tab === "market" ? "active" : ""} onClick={() => { setTab("market"); window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}#market`); }}>{isAuction?"Available players":"Player market"}</button><button className={tab === "claims" ? "active" : ""} onClick={() => { setTab("claims"); window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}#claims`); }}>{isAuction?"My offers":"My claims"}</button></nav>
    {!userId && !loading ? <section className="panel empty-feature"><span>↻</span><h2>Sign in to manage waivers</h2><p>Your claims, roster, and waiver priority are private to your league.</p><Link className="primary-button" href="/login?next=/waivers">Log in</Link></section> : !league && !loading ? <section className="panel empty-feature"><span>＋</span><h2>Join a league first</h2><p>Waivers open for managers after a league draft is complete.</p><Link className="primary-button" href="/league">Open leagues</Link></section> : <>
      <section className="waiver-summary"><div><small>{isAuction?"CONTRACT BUDGET":"YOUR PRIORITY"}</small><strong>{isAuction?`$${Math.round(contractBudget/1000000)}M`:`#${priority.find((item) => item.user_id === userId)?.rank ?? "—"}`}</strong></div><div><small>YOUR ROSTER</small><strong>{roster.length}/18</strong></div><div><small>{windowState?`GW ${windowState.gameweek} · ${isAuction&&windowState.phase==="waivers"?"blind window":windowState.phase.replace("_"," ")}`:"SCHEDULE"}</small><strong>{windowState?.phase==="locked"?"LOCKED":isAuction?contractOffers.filter(offer=>offer.status==="pending").length:claims.filter((claim) => claim.user_id === userId && claim.status === "pending").length}</strong></div></section>
      {windowState?<p className="panel waiver-message">{isAuction?(windowState.phase==="waivers"?`Contract offers stay private until ${new Date(windowState.waiver_process_at).toLocaleString()}. Highest offer wins; ties use rolling priority.`:windowState.phase==="free_agency"?`This contract window has been executed. Available players return in the next Blind Contract Window.`:`Contracts locked at ${new Date(windowState.roster_lock_at).toLocaleString()}. Set your lineup.`):(windowState.phase==="waivers"?`Rank claims before ${new Date(windowState.waiver_process_at).toLocaleString()}.`:windowState.phase==="free_agency"?`Free-agent pickups are immediate until ${new Date(windowState.roster_lock_at).toLocaleString()}.`:`Rosters locked at ${new Date(windowState.roster_lock_at).toLocaleString()}. Set your lineup.`)}</p>:<p className="panel waiver-message">The commissioner must schedule the next gameweek before transactions open.</p>}
      {message ? <p className="panel waiver-message">{message}</p> : null}
      {tab === "market" ? <section className="panel">
        <div className="section-row"><div><h2>{isAuction?"Available players":"Player market"}</h2><small>Showing {Math.min(marketPlayers.length, 60)} of {marketPlayers.length}</small></div><label className="market-sort">Sort<select value={sort} onChange={(event) => setSort(event.target.value as "RANK" | "POINTS")}><option value="RANK">Player rank</option><option value="POINTS">Fantasy points</option></select></label></div>
        <div className="market-status-filter">{(["ALL", "AVAILABLE", "WATCHLIST"] as const).map((item) => <button key={item} className={marketFilter === item ? "active" : ""} onClick={() => setMarketFilter(item)}>{item}</button>)}</div>
        <div className="search-box"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search player, club, or league" /></div>
        <div className="filter-row">{["ALL", "GK", "DEF", "MID", "FWD"].map((item) => <button key={item} className={position === item ? "active" : ""} onClick={() => setPosition(item)}>{item}</button>)}</div>
        <div className="player-list waiver-player-list">{marketPlayers.slice(0, 60).map((player) => { const owner = ownerByPlayer.get(player.id); const totals = totalsByPlayer.get(player.id) ?? emptyTotals; const watching=watchlist.has(player.id); return <article key={player.id} role="button" tabIndex={0} onClick={() => setStatsPlayer(player)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setStatsPlayer(player); }}><PlayerHeadshot name={player.full_name} position={player.position} photoUrl={player.photo_url}/><div><strong>{player.full_name}</strong><small>#{player.draft_rank ?? "—"} · {player.club} · {player.competition}</small>{owner ? <small className="ownership-label">{isAuction?"Under contract with":"Owned by"} {owner}</small> : <small className="available-label">Available · tap for stats</small>}</div><button type="button" aria-label={watching?`Remove ${player.full_name} from watchlist`:`Add ${player.full_name} to watchlist`} title={watching?"Remove from watchlist":"Add to watchlist"} onClick={(event)=>{event.stopPropagation();void toggleWatchlist(player.id)}} style={{border:"0",background:"transparent",fontSize:"22px",lineHeight:1,padding:"4px",cursor:"pointer",color:watching?"var(--lime)":"var(--muted)"}}>{watching?"★":"☆"}</button><b className="fantasy-points-chip">{totals.points} FP</b>{owner ? <span className="owned-chip">{isAuction?"SIGNED":"OWNED"}</span> : <button className="claim-button" disabled={!windowState||windowState.phase==="locked"||(isAuction&&windowState.phase!=="waivers")} onClick={(event) => { event.stopPropagation(); setSelected(player); setDropId("");setOfferAmount(""); }}>{isAuction?windowState?.phase==="waivers"?"OFFER":"WINDOW CLOSED":windowState?.phase==="free_agency"?"ADD NOW":"CLAIM"}</button>}</article>; })}{!loading && marketPlayers.length === 0 ? <p className="empty-state">{marketFilter==="WATCHLIST"?"Your watchlist is empty.":"No players match those filters."}</p> : null}</div>
      </section> : isAuction?<section className="panel claim-history"><div className="section-row"><div><h2>My contract offers</h2><small>Competing offers remain private</small></div><span className="muted-chip">{contractOffers.length}</span></div>{contractOffers.length===0?<p className="empty-state">No contract offers yet.</p>:contractOffers.sort((a,b)=>a.status==="pending"&&b.status==="pending"?a.offer_rank-b.offer_rank:new Date(b.created_at).getTime()-new Date(a.created_at).getTime()).map(offer=>{const add=playerMap.get(offer.add_player_id),release=playerMap.get(offer.release_player_id),pending=offer.status==="pending";return <article key={offer.id}><div><span className={`claim-status ${offer.status}`}>{pending?`#${offer.offer_rank} private`:offer.status}</span><strong>{add?.full_name??"Player"} · ${Math.round(offer.amount/1000000)}M</strong><small>GW {offer.gameweek} · Release {release?.full_name??"player"}{offer.note?` · ${offer.note}`:""}</small></div>{pending?<div><button aria-label="Move offer up" onClick={()=>void moveContractOffer(offer.id,-1)} disabled={busy||offer.offer_rank===1}>↑</button><button aria-label="Move offer down" onClick={()=>void moveContractOffer(offer.id,1)} disabled={busy}>↓</button><button onClick={()=>void cancelContractOffer(offer.id)} disabled={busy}>Cancel</button></div>:null}</article>})}</section>:<><section className="panel waiver-priority"><div className="section-row"><h2>Waiver priority</h2><small>Randomized each gameweek</small></div>{priority.map((item) => <article key={item.user_id} className={item.user_id === userId ? "you" : ""}><span>{item.rank}</span><strong>{item.team_name}</strong>{item.user_id === userId ? <small>YOU</small> : null}</article>)}</section><section className="panel claim-history"><div className="section-row"><h2>Claim history</h2><span className="muted-chip">{claims.length}</span></div>{claims.length === 0 ? <p className="empty-state">No waiver claims yet.</p> : claims.sort((a,b)=>a.status==="pending"&&b.status==="pending"?a.claim_rank-b.claim_rank:new Date(b.created_at).getTime()-new Date(a.created_at).getTime()).map((claim) => { const add = playerMap.get(claim.add_player_id); const drop = claim.drop_player_id ? playerMap.get(claim.drop_player_id) : null; const minePending=claim.user_id===userId&&claim.status==="pending";return <article key={claim.id}><div><span className={`claim-status ${claim.status}`}>{minePending?`#${claim.claim_rank} ${claim.status}`:claim.status}</span><strong>{teamMap.get(claim.user_id) ?? "Your team"}: {add?.full_name ?? "Player"}</strong><small>GW {claim.gameweek} · {drop ? `Drop ${drop.full_name} · ` : ""}{new Date(claim.created_at).toLocaleString()}{claim.note ? ` · ${claim.note}` : ""}</small></div>{minePending?<div><button aria-label="Move claim up" onClick={()=>void moveClaim(claim.id,-1)} disabled={busy||claim.claim_rank===1}>↑</button><button aria-label="Move claim down" onClick={()=>void moveClaim(claim.id,1)} disabled={busy}>↓</button><button onClick={() => void cancelClaim(claim.id)} disabled={busy}>Cancel</button></div>:null}</article>; })}</section></>}
    </>}
    {selected ? <div className="waiver-overlay" role="dialog" aria-modal="true" aria-label="Submit player transaction"><section className="panel waiver-dialog"><p className="eyebrow">{isAuction?"BLIND CONTRACT OFFER":windowState?.phase==="free_agency"?"FREE AGENT":"WAIVER CLAIM"}</p><h2>{isAuction?"Offer a contract to":"Add"} {selected.full_name}</h2><p>{isAuction?"Your offer stays private until the processing day. Choose the player whose current contract will be released if this offer wins.":"Select the player who will leave your 18-player roster. Position limits and four players per club are enforced."}</p>{isAuction?<label>Contract offer ($M)<input type="number" min="1" step="1" inputMode="numeric" value={offerAmount} onChange={event=>setOfferAmount(event.target.value)} placeholder="Minimum $1M"/><small>${Math.round(contractBudget/1000000)}M available</small></label>:null}<label>{isAuction?"Release if offer wins":"Drop from your roster"}<select value={dropId} onChange={(event) => setDropId(event.target.value)}><option value="">Choose a player</option>{roster.map((player) => <option key={player.id} value={player.id}>{player.position} · {player.full_name}</option>)}</select></label><div><button className="secondary-button" onClick={() => setSelected(null)} disabled={busy}>Back</button><button className="primary-button" onClick={() => void submitClaim()} disabled={busy || !dropId||(isAuction&&(!offerAmount||Number(offerAmount)<1||Number(offerAmount)*1000000>contractBudget))}>{busy ? "Saving…" : isAuction?"Submit private offer":windowState?.phase==="free_agency"?"Add now":"Submit claim"}</button></div></section></div> : null}
    {statsPlayer&&league?<PlayerStatsDialog leagueId={league.league_id} player={statsPlayer} onClose={()=>setStatsPlayer(null)}/>:null}
  </PageShell>;
}
