"use client";

import { useMemo, useState } from "react";
import { PageShell } from "./page-shell";
import { simulatedTeams, type SimulatedPlayer } from "@/lib/simulated-gameweek";

type TradeStatus = "building" | "pending" | "accepted" | "declined";
type TradeEvent = { label: string; detail: string };

export function TradeCenter() {
  const [yourRoster, setYourRoster] = useState<SimulatedPlayer[]>(simulatedTeams[0].players);
  const [theirRoster, setTheirRoster] = useState<SimulatedPlayer[]>(simulatedTeams[1].players);
  const [offered, setOffered] = useState<number[]>([]);
  const [requested, setRequested] = useState<number[]>([]);
  const [status, setStatus] = useState<TradeStatus>("building");
  const [history, setHistory] = useState<TradeEvent[]>([]);
  const offerPlayers = useMemo(() => yourRoster.filter((player) => offered.includes(player.id)), [yourRoster, offered]);
  const requestPlayers = useMemo(() => theirRoster.filter((player) => requested.includes(player.id)), [theirRoster, requested]);
  const canPropose = offered.length > 0 && requested.length > 0 && status === "building";

  function toggle(id: number, side: "offer" | "request") {
    const setter = side === "offer" ? setOffered : setRequested;
    setter((current) => current.includes(id) ? current.filter((playerId) => playerId !== id) : [...current, id]);
  }

  function propose() {
    if (!canPropose) return;
    setStatus("pending");
    setHistory([{ label: "Trade proposed", detail: `Your XI offered ${offerPlayers.map((player) => player.name).join(", ")} for ${requestPlayers.map((player) => player.name).join(", ")}.` }]);
  }

  function respond(accept: boolean) {
    if (status !== "pending") return;
    if (!accept) {
      setStatus("declined");
      setHistory((events) => [...events, { label: "Trade declined", detail: "Barrio XI declined the offer. No ownership changed." }]);
      return;
    }
    setYourRoster((players) => [...players.filter((player) => !offered.includes(player.id)), ...requestPlayers]);
    setTheirRoster((players) => [...players.filter((player) => !requested.includes(player.id)), ...offerPlayers]);
    setStatus("accepted");
    setHistory((events) => [...events, { label: "Trade accepted", detail: "Ownership transferred atomically and both rosters were updated." }]);
  }

  function reset() {
    setOffered([]);
    setRequested([]);
    setStatus("building");
    setHistory([]);
  }

  return (
    <PageShell eyebrow="SIMULATED TRADE CENTER" title="Build a trade">
      <section className="trade-summary">
        <div><small>YOU SEND</small><strong>{offered.length}</strong></div>
        <span>⇄</span>
        <div><small>YOU RECEIVE</small><strong>{requested.length}</strong></div>
      </section>
      <section className="trade-grid">
        <TradeRoster title="Your XI" instruction="Select players to offer" roster={yourRoster} selected={offered} onToggle={(id) => toggle(id, "offer")} disabled={status !== "building"} />
        <TradeRoster title="Barrio XI" instruction="Select players to request" roster={theirRoster} selected={requested} onToggle={(id) => toggle(id, "request")} disabled={status !== "building"} />
      </section>
      {status === "building" ? <button className="primary-button full-button" onClick={propose} disabled={!canPropose}>Propose trade</button> : null}
      {status === "pending" ? <section className="panel trade-review">
        <p className="eyebrow">OTHER MANAGER’S VIEW</p><h2>Trade offer received</h2>
        <p>Review both sides before responding. This simulates the recipient manager.</p>
        <div className="trade-actions"><button className="decline-button" onClick={() => respond(false)}>Decline</button><button className="primary-button" onClick={() => respond(true)}>Accept trade</button></div>
      </section> : null}
      {status === "accepted" || status === "declined" ? <button className="primary-button full-button" onClick={reset}>Build another trade</button> : null}
      {history.length ? <section className="panel trade-history"><div className="section-row"><h2>Trade history</h2><span className={`trade-status ${status}`}>{status}</span></div>{history.map((event, index) => <article key={`${event.label}-${index}`}><span>{index + 1}</span><div><strong>{event.label}</strong><small>{event.detail}</small></div></article>)}</section> : null}
      <p className="simulation-note">Simulation mode lets you test both managers’ decisions. Real league offers are private to the two managers and enforced by Supabase.</p>
    </PageShell>
  );
}

function TradeRoster({ title, instruction, roster, selected, onToggle, disabled }: { title: string; instruction: string; roster: SimulatedPlayer[]; selected: number[]; onToggle: (id: number) => void; disabled: boolean }) {
  return <section className="panel trade-roster"><div className="section-row"><div><h2>{title}</h2><small>{instruction}</small></div><span className="muted-chip">{selected.length}</span></div>{roster.map((player) => <button key={player.id} className={selected.includes(player.id) ? "selected" : ""} onClick={() => onToggle(player.id)} disabled={disabled}><span className={`position ${player.stats.position.toLowerCase()}`}>{player.stats.position}</span><span><strong>{player.name}</strong><small>{player.club}</small></span><i>{selected.includes(player.id) ? "✓" : "+"}</i></button>)}</section>;
}
