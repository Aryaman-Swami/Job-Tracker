const BREAKDOWN_LABELS = { keywords: 'Keyword match', skills: 'Skills', experience: 'Experience fit', title_alignment: 'Role alignment' };

const clamp = v => Math.max(0, Math.min(100, Number(v) || 0));

// The match score as a figure over a bullet bar: the blue fill is the score at its true
// ratio, the grey tick is the previous score from this session when there is one.
export default function AtsScoreCard({ score, prevScore, breakdown, matched_keywords, missing_keywords, suggestions }) {
  const change = prevScore != null ? score - prevScore : null;
  return (
    <>
      <div>
        <div className="score-line">
          <span className="score">{score}</span>
          <span className="score-of">/100</span>
          {change != null && (
            <span className={`score-change${change > 0 ? ' up' : change < 0 ? ' down' : ''}`}>
              {change > 0 ? '+' : change < 0 ? '−' : ''}{Math.abs(change)} from {prevScore}
            </span>
          )}
        </div>
        <div className="bullet" role="img" aria-label={`Match score ${score} of 100`}>
          <div className="bullet-fill" style={{ width: `${clamp(score)}%` }} />
          {prevScore != null && <span className="bullet-prev" style={{ left: `${clamp(prevScore)}%` }} />}
        </div>
        <div className="bullet-ends"><span>0</span><span>100</span></div>
      </div>

      {breakdown && Object.keys(breakdown).length > 0 && (
        <div className="breakdown">
          {Object.entries(breakdown).map(([key, val]) => (
            <div className="breakdown-row" key={key}>
              <span className="breakdown-label">{BREAKDOWN_LABELS[key] || key}</span>
              <div className="breakdown-track"><div className="breakdown-fill" style={{ width: `${clamp(val)}%` }} /></div>
              <span className="breakdown-pct">{val}</span>
            </div>
          ))}
        </div>
      )}

      {matched_keywords?.length > 0 && (
        <div>
          <div className="kw-title">Matched keywords</div>
          <div className="chips">{matched_keywords.map(k => <span className="chip" key={k}>{k}</span>)}</div>
        </div>
      )}

      {missing_keywords?.length > 0 && (
        <div>
          <div className="kw-title">Missing keywords</div>
          <div className="chips">{missing_keywords.map(k => <span className="chip miss" key={k}>{k}</span>)}</div>
        </div>
      )}

      {suggestions?.length > 0 && (
        <div>
          <div className="kw-title">Suggestions</div>
          <ul className="suggestions">{suggestions.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </div>
      )}
    </>
  );
}
