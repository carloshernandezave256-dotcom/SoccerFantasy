"use client";

import { useMemo, useState } from "react";
import { PageShell } from "./page-shell";
import { playerCatalog, type CatalogPlayer } from "@/lib/player-catalog";

type Pick = { player: CatalogPlayer; team: string };
const cpuTeams = ["North End FC", "Barrio XI", "Calcio Club"];

export function PracticeDraft() {
  const [picks, setPicks] = useState<Pick[]>([]);
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState("ALL");
  const [pending, setPending] = useState<CatalogPlayer | null>(null);
  const [message, setMessage] = useState("Your turn. Choose any available player.");
  const pickedIds = useMemo(() => new Set(picks.map(({ player }) => player.id)), [picks]);
  const available = useMemo(
    () => playerCatalog.filter((player) =>
      !pickedIds.has(player.id) &&
      (position === "ALL" || player.position === position) &&
      `${player.name} ${player.club} ${player.league}`.toLowerCase().includes(query.toLowerCase())
    ),
    [pickedIds, position, query]
  );
  const myPicks = picks.filter(({ team }) => team === "Your XI");

  function confirmPick() {
    if (!pending || pickedIds.has(pending.id)) return;
    const nextPicks: Pick[] = [...picks, { player: pending, team: "Your XI" }];
    const remaining = playerCatalog.filter((player) => !pickedIds.has(player.id) && player.id !== pending.id);
    cpuTeams.forEach((team, index) => {
      const cpuPlayer = remaining[index];
      if (cpuPlayer) nextPicks.push({ player: cpuPlayer, team });
    });
    setPicks(nextPicks);
    setMessage(`${pending.name} added to Your XI. CPU picks are complete—you're back on the clock.`);
    setPending(null);
  }

  function reset() {
    setPicks([]);
    setPending(null);
    setMessage("Your turn. Choose any available player.");
  }

  return (
    <PageShell eyebrow="PRACTICE DRAFT" title="Choose your players">
      <section className="practice-status">
        <div><small>YOUR PICKS</small><strong>{myPicks.length}</strong></div>
        <p>{message}</p>
        <button className="text-button" onClick={reset} disabled={!picks.length}>Reset</button>
      </section>
      {myPicks.length ? <section className="panel practice-roster">
        <div className="section-row"><h2>Your XI</h2><span className="muted-chip">{myPicks.length}</span></div>
        {myPicks.map(({ player }) => <div className="pick-row" key={player.id}><b>{player.position}</b><span>{player.name}</span><small>{player.club}</small></div>)}
      </section> : null}
      <div className="search-box">⌕<input aria-label="Search available players" placeholder="Search available players" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
      <div className="filter-row">{["ALL", "GK", "DEF", "MID", "FWD"].map((item) => <button key={item} className={position === item ? "active" : ""} onClick={() => setPosition(item)}>{item}</button>)}</div>
      <section className="panel player-list draft-list">
        {available.map((player) => <article key={player.id}>
          <span className={`position ${player.position.toLowerCase()}`}>{player.position}</span>
          <button className="player-summary" onClick={() => setPending(player)}>
            <strong>{player.name}</strong><small>{player.club} · {player.league}</small>
          </button>
          <button className="draft-button" onClick={() => setPending(player)}>SELECT</button>
        </article>)}
        {!available.length ? <p className="empty-state">No available players match this filter.</p> : null}
      </section>
      {pending ? <div className="confirm-overlay" role="presentation" onClick={() => setPending(null)}>
        <section className="confirm-card" role="dialog" aria-modal="true" aria-labelledby="confirm-player" onClick={(event) => event.stopPropagation()}>
          <span className={`position ${pending.position.toLowerCase()}`}>{pending.position}</span>
          <h2 id="confirm-player">{pending.name}</h2>
          <p>{pending.club} · {pending.league}</p>
          <button className="primary-button full-button" onClick={confirmPick}>Confirm selection</button>
          <button className="text-button full-button" onClick={() => setPending(null)}>Cancel</button>
        </section>
      </div> : null}
    </PageShell>
  );
}
