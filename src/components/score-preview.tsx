import { calculateScore, type PlayerMatchStats } from "@/lib/scoring";

const example: PlayerMatchStats = {
  position: "MID",
  minutes: 90,
  goals: 1,
  assists: 1,
  shotsOnTarget: 2,
  completedPasses: 42,
  tacklesWon: 3,
  manOfTheMatch: true,
};

export function ScorePreview() {
  const score = calculateScore(example);
  return (
    <section className="panel score-panel">
      <div className="section-row">
        <div><p className="eyebrow">AUDIT LEDGER</p><h2>Why your player scored {score.total}</h2></div>
        <span className="score-total">{score.total}</span>
      </div>
      <div className="ledger">
        {score.entries.map((entry) => (
          <div key={entry.code}>
            <span><strong>{entry.label}</strong><small>{entry.detail}</small></span>
            <b className={entry.points < 0 ? "negative" : "positive"}>{entry.points > 0 ? "+" : ""}{entry.points}</b>
          </div>
        ))}
      </div>
    </section>
  );
}
