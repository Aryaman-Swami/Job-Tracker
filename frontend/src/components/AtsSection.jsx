import { useState } from 'react';
import AtsScoreCard from './AtsScoreCard.jsx';

export default function AtsSection({ atsResult, loading, onRun, onApplyGaps }) {
  const [open, setOpen] = useState(false);
  const [extra, setExtra] = useState('');

  async function toggle() {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (!atsResult) await onRun();
  }

  async function rerun() {
    await onRun();
  }

  function applyGaps() {
    if (!atsResult) { alert('Run an ATS score for this job first.'); return; }
    const missing = atsResult.missing_keywords || [];
    const suggestions = atsResult.suggestions || [];
    if (!missing.length && !suggestions.length && !extra.trim()) {
      alert('Nothing to apply — the last scan had no missing keywords or suggestions, and no additional instructions were entered.');
      return;
    }
    onApplyGaps({ missing_keywords: missing, suggestions, extra_instructions: extra.trim() || undefined });
  }

  return (
    <>
      <button className="btn-referral" onClick={toggle} disabled={loading}>
        {loading ? '⏳ Analyzing…' : '📊 ATS Score'}
      </button>
      {open && (
        <div className="referral-box">
          <div className="referral-header">
            <span>ATS Match Score</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="copy-btn" onClick={applyGaps}>Apply Gaps to Tailoring</button>
              <button className="copy-btn" onClick={rerun}>Re-run</button>
            </div>
          </div>
          <div className="ats-content">
            {atsResult ? <AtsScoreCard {...atsResult} /> : <div style={{ color: '#999', fontSize: '0.82rem' }}>No score yet — click Re-run to analyze.</div>}
          </div>
          <div className="ats-extra-prompt-wrap" style={{ padding: '0 16px 16px' }}>
            <label className="resume-section-label">Additional instructions (optional, used when applying gaps)</label>
            <textarea className="ats-extra-prompt" rows={2}
              placeholder="e.g. emphasize leadership, keep it formal, don't touch the Skills section..."
              value={extra} onChange={e => setExtra(e.target.value)} />
          </div>
        </div>
      )}
    </>
  );
}
