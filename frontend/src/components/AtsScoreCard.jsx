import { scoreClass, scoreColor } from '../utils.js';

const BREAKDOWN_LABELS = { keywords: 'Keyword Match', skills: 'Skills Alignment', experience: 'Experience Fit', title_alignment: 'Role Alignment' };

export default function AtsScoreCard({ score, breakdown, matched_keywords, missing_keywords, suggestions }) {
  const color = scoreColor(score);
  const deg = score * 3.6;

  return (
    <>
      <div className="ats-score-ring">
        <div className="ats-score-circle" style={{ background: `conic-gradient(${color} ${deg}deg,#f0f0f0 0deg)` }}>
          <div className="ats-score-inner">
            <span className="ats-score-num" style={{ color }}>{score}</span>
            <span className="ats-score-denom">/100</span>
          </div>
        </div>
        <div className="ats-score-label">ATS Match Score</div>
      </div>

      {breakdown && Object.keys(breakdown).length > 0 && (
        <div className="ats-breakdown">
          {Object.entries(breakdown).map(([key, val]) => (
            <div className="ats-row" key={key}>
              <span className="ats-row-label">{BREAKDOWN_LABELS[key] || key}</span>
              <div className="ats-track"><div className={`ats-fill ${scoreClass(val)}`} style={{ width: `${val}%` }} /></div>
              <span className="ats-row-pct">{val}</span>
            </div>
          ))}
        </div>
      )}

      {matched_keywords?.length > 0 && (
        <div className="ats-keywords">
          <div className="ats-kw-title">Matched</div>
          <div className="ats-chips">{matched_keywords.map(k => <span className="ats-chip match" key={k}>{k}</span>)}</div>
        </div>
      )}

      {missing_keywords?.length > 0 && (
        <div className="ats-keywords">
          <div className="ats-kw-title">Missing</div>
          <div className="ats-chips">{missing_keywords.map(k => <span className="ats-chip miss" key={k}>{k}</span>)}</div>
        </div>
      )}

      {suggestions?.length > 0 && (
        <div className="ats-suggestions">
          <div className="ats-kw-title">Suggestions</div>
          <ul>{suggestions.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </div>
      )}
    </>
  );
}

export function AtsMiniBadge({ score }) {
  if (score === null || score === undefined) return null;
  return (
    <span className={`ats-mini-badge ${scoreClass(score)}`} title="Last ATS score (saved)">
      <span className="ats-mini-badge-dot" />
      ATS {score}
    </span>
  );
}
