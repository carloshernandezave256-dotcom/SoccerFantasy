import { BottomNav } from "@/components/bottom-nav";
import { ScorePreview } from "@/components/score-preview";

const leaders = [
  { rank: 1, team: "Barrio XI", record: "7–2", points: 681 },
  { rank: 2, team: "Tiki Taka", record: "6–3", points: 654 },
  { rank: 3, team: "Calcio Club", record: "6–3", points: 631 },
];

export default function Home() {
  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">MATCHWEEK 9</p>
          <h1>Good evening, Carlos</h1>
        </div>
        <button className="avatar" aria-label="Open profile">CH</button>
      </header>

      <section className="match-card" aria-labelledby="matchup-title">
        <div className="section-row">
          <div>
            <p className="eyebrow">LIVE MATCHUP</p>
            <h2 id="matchup-title">One point in it.</h2>
          </div>
          <span className="live-pill"><span />LIVE</span>
        </div>
        <div className="versus">
          <div><strong>54.5</strong><span>Barrio XI</span></div>
          <div className="versus-mark">VS</div>
          <div><strong>53.5</strong><span>Tiki Taka</span></div>
        </div>
        <div className="progress"><span style={{ width: "51%" }} /></div>
        <p className="muted">4 players remaining · closes Sunday 12:30 PM</p>
      </section>

      <section className="quick-grid" aria-label="League shortcuts">
        <article><span className="icon">◎</span><strong>My Team</strong><small>Set your XI</small></article>
        <article><span className="icon">↗</span><strong>Players</strong><small>Scout all five leagues</small></article>
        <article><span className="icon">⇄</span><strong>Waivers</strong><small>Priority: 4th</small></article>
      </section>

      <section className="panel">
        <div className="section-row"><h2>League table</h2><button className="text-button">Full table</button></div>
        <div className="table-head"><span>Club</span><span>W–L</span><span>PTS</span></div>
        {leaders.map((leader) => (
          <div className="table-row" key={leader.team}>
            <span className="rank">{leader.rank}</span><strong>{leader.team}</strong>
            <span>{leader.record}</span><span>{leader.points}</span>
          </div>
        ))}
      </section>

      <ScorePreview />
      <BottomNav />
    </main>
  );
}
