import { useState } from 'react';
import HackerRankScoreCard from './HackerRankScoreCard.jsx';

export default function HackerRankSection({ result, loading, onRun }) {
  const [open, setOpen] = useState(false);

  async function toggle() {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (!result) await onRun();
  }

  return (
    <>
      <button className="btn-referral" onClick={toggle} disabled={loading}>
        {loading ? '⏳ Analyzing…' : '🏆 HackerRank ATS Score'}
      </button>
      {open && (
        <div className="referral-box">
          <div className="referral-header">
            <span>HackerRank Intern Rubric Score</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="copy-btn" onClick={onRun}>Re-run</button>
            </div>
          </div>
          <div className="ats-content">
            {result ? <HackerRankScoreCard {...result} /> : <div style={{ color: 'var(--text-3)', fontSize: '0.82rem' }}>No score yet — click Re-run to analyze.</div>}
          </div>
        </div>
      )}
    </>
  );
}
