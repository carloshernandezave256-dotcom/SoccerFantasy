"use client";

import { useMemo, useState } from "react";
import { PageShell } from "./page-shell";
import { calculateScore } from "@/lib/scoring";
import { simulatedTeams, type SimulatedPlayer } from "@/lib/simulated-gameweek";

export function SimulatedMatchup() {
  const [selected, setSelected] = useState<SimulatedPlayer | null>(null);
  const [activeTeam, setActiveTeam] = useState(0);
  const scoredTeams = useMemo(() => simulatedTeams.map((team) => ({
    ...team,
    players: team.players.map((player) => ({ ...player, score: calculateScore(player.stats) })),
  })), []);
  const totals = scoredTeams.map((team) => team.players.reduce((sum, player) => sum + player.score.total, 0));
  const selectedScore = selected ? calculateScore(selected.stats) : null;
  const yourWin = totals[0] > totals[1];
  const margin = Math.abs(totals[0] - totals[1]);

  return (
    <PageShell eyebrow="SIMULATED MATCHWEEK 1" title="Head to head">
      <section className="match-card gameweek-score">
        <span className="simulation-chip">SIMULATION</span>
        <div className="versus">
          <div><strong>{totals[0]}</strong><span>{scoredTeams[0].name}</span></div>
          <div className="versus-mark">VS</div>
          <div><strong>{totals[1]}</strong><span>{scoredTeams[1].name}</span></div>
        </div>
        <div className="progress"><span style={{ width: `${(totals[0] / (totals[0] + totals[1])) * 100}%` }} /></div>
        <p className="match-result">{yourWin ? `Your XI wins by ${margin}` : totals[0] === totals[1] ? "Matchweek draw" : `Barrio XI wins by ${margin}`}</p>
        <div className="match-status"><span className="live-dot" /> Final · All 11 players scored</div>
      </section>
      <div className="segmented team-tabs" aria-label="Matchup teams">
        {scoredTeams.map((team, index) => <button key={team.name} className={activeTeam === index ? "active" : ""} onClick={() => setActiveTeam(index)} aria-pressed={activeTeam === index}>{team.name}<b>{totals[index]}</b></button>)}
      </div>
      <div className="matchup-lineups">
        {scoredTeams.map((team, teamIndex) => <section className={`panel matchup-team ${activeTeam === teamIndex ? "active" : ""}`} key={team.name}>
          <div className="section-row"><h2>{team.name}</h2><strong className="team-total">{team.players.reduce((sum, player) => sum + player.score.total, 0)} pts</strong></div>
          {team.players.map((player) => <button className="scored-player" key={player.id} onClick={() => setSelected(player)}>
            <span className={`position ${player.stats.position.toLowerCase()}`}>{player.stats.position}</span>
            <span><strong>{player.name}{player.stats.starPickWinner ? <em className="captain-badge">★</em> : null}</strong><small>{player.club} · {player.stats.minutes} min</small></span>
            <b className={player.score.total < 0 ? "negative" : "positive"}>{player.score.total}</b>
            <i>›</i>
          </button>)}
        </section>)}
      </div>
      <section className="panel standings-result">
        <div className="section-row"><h2>Standings update</h2><span className="muted-chip">AFTER GW1</span></div>
        <div className="table-row"><span className="rank">1</span><strong>{yourWin ? "Your XI" : "Barrio XI"}</strong><span>1–0–0</span><b>3</b></div>
        <div className="table-row"><span className="rank">2</span><strong>{yourWin ? "Barrio XI" : "Your XI"}</strong><span>0–0–1</span><b>0</b></div>
      </section>
      {selected && selectedScore ? <div className="confirm-overlay ledger-overlay" role="presentation" onClick={() => setSelected(null)}>
        <section className="confirm-card player-ledger" role="dialog" aria-modal="true" aria-labelledby="player-ledger-title" onClick={(event) => event.stopPropagation()}>
          <button className="ledger-close" aria-label="Close scoring breakdown" onClick={() => setSelected(null)}>×</button>
          <span className={`position ${selected.stats.position.toLowerCase()}`}>{selected.stats.position}</span>
          <p className="eyebrow">SCORING BREAKDOWN</p>
          <h2 id="player-ledger-title">{selected.name}</h2>
          <p>{selected.club} · {selected.stats.minutes} minutes {selected.stats.starPickWinner ? "· Winning Star Pick" : ""}</p>
          <div className="ledger-total"><span>Fantasy points</span><strong>{selectedScore.total}</strong></div>
          <div className="ledger">
            {selectedScore.entries.map((entry) => <div key={entry.code}><span><strong>{entry.label}</strong><small>{entry.detail}</small></span><b className={entry.points < 0 ? "negative" : "positive"}>{entry.points > 0 ? "+" : ""}{entry.points}</b></div>)}
          </div>
          <div className="ledger-reconcile"><span>Ledger total</span><strong>{selectedScore.total} pts</strong></div>
        </section>
      </div> : null}
    </PageShell>
  );
}
