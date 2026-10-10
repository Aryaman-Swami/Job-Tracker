function scoreClassFor(pct) {
  return pct >= 75 ? 'good' : pct >= 50 ? 'ok' : 'bad';
}

export default function HackerRankScoreCard({ total, max_final_score, breakdown, bonus_points, deductions, key_strengths, areas_for_improvement }) {
  const pct = Math.max(0, Math.min(100, (total / max_final_score) * 100));
  const color = pct >= 60 ? '#1a9455' : pct >= 35 ? '#d97706' : '#c0392b';
  const deg = pct * 3.6;

  return (
    <>
      <div className="ats-score-ring">
        <div className="ats-score-circle" style={{ background: `conic-gradient(${color} ${deg}deg,var(--ring-track) 0deg)` }}>
          <div className="ats-score-inner">
            <span className="ats-score-num" style={{ color }}>{total}</span>
            <span className="ats-score-denom">/{max_final_score}</span>
          </div>
        </div>
        <div className="ats-score-label">HackerRank Intern Rubric</div>
      </div>

      {breakdown?.length > 0 && (
        <div className="ats-breakdown">
          {breakdown.map(cat => {
            const val = cat.max ? Math.round((cat.score / cat.max) * 100) : 0;
            return (
              <div className="ats-row" key={cat.key}>
                <span className="ats-row-label">{cat.icon} {cat.label}</span>
                <div className="ats-track"><div className={`ats-fill ${scoreClassFor(val)}`} style={{ width: `${val}%` }} /></div>
                <span className="ats-row-pct">{cat.score}/{cat.max}</span>
              </div>
            );
          })}
        </div>
      )}

      {(bonus_points?.total || deductions?.total) ? (
        <div className="ats-suggestions">
          <div className="ats-kw-title">Bonus / Deductions</div>
          <ul>
            {bonus_points?.total ? <li>+{bonus_points.total} bonus: {bonus_points.breakdown || ''}</li> : null}
            {deductions?.total ? <li>-{deductions.total} deducted: {deductions.reasons || ''}</li> : null}
          </ul>
        </div>
      ) : null}

      {breakdown?.some(c => c.evidence) && (
        <div className="ats-suggestions">
          <div className="ats-kw-title">Evidence</div>
          <ul>{breakdown.map(cat => <li key={cat.key}><strong>{cat.icon} {cat.label}:</strong> {cat.evidence}</li>)}</ul>
        </div>
      )}

      {key_strengths?.length > 0 && (
        <div className="ats-suggestions">
          <div className="ats-kw-title">Key Strengths</div>
          <ul>{key_strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </div>
      )}

      {areas_for_improvement?.length > 0 && (
        <div className="ats-suggestions">
          <div className="ats-kw-title">Areas for Improvement</div>
          <ul>{areas_for_improvement.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </div>
      )}
    </>
  );
}
