import { useState } from 'react';
import AtsScoreCard from './AtsScoreCard.jsx';
import Card from './Card.jsx';

export default function AtsSection({ atsResult, prevScore, loading, error, onRun, onApplyGaps, tailoring }) {
  const [extra, setExtra] = useState('');
  const missing = atsResult?.missing_keywords || [];
  const suggestions = atsResult?.suggestions || [];
  const nothingToApply = !missing.length && !suggestions.length && !extra.trim();

  function applyGaps() {
    if (!atsResult || nothingToApply) return;
    onApplyGaps({ missing_keywords: missing, suggestions, extra_instructions: extra.trim() || undefined });
  }

  return (
    <Card
      title="Match score"
      actions={
        <button type="button" className="btn" onClick={onRun} disabled={loading} aria-busy={loading}>
          {loading && <span className="spinner" aria-hidden="true" />}
          {loading ? 'Checking…' : atsResult ? 'Re-run' : 'Run ATS check'}
        </button>
      }
    >
      {error && (
        <p className="error-line" role="alert">
          ATS check failed: {error}
          <button type="button" className="link-btn" onClick={onRun}>Try again</button>
        </p>
      )}
      {atsResult
        ? <AtsScoreCard {...atsResult} prevScore={prevScore} />
        : loading
          ? <div><span className="skeleton score-skeleton" style={{ display: 'block' }} /><div className="bullet" /></div>
          : <p className="muted">No match score yet. Run an ATS check to compare your resume with this posting.</p>}

      {atsResult && (
        <details className="disclosure">
          <summary>Use the gaps when tailoring</summary>
          <div className="disclosure-body">
            <label className="field-label">
              <span>Extra instructions <span className="hint">(optional)</span></span>
              <textarea className="control" rows={2} placeholder="e.g. keep it formal, leave the Skills section alone"
                value={extra} onChange={e => setExtra(e.target.value)} />
            </label>
            <div>
              <button type="button" className="btn" onClick={applyGaps} disabled={nothingToApply || tailoring}>
                Tailor with these gaps
              </button>
            </div>
            {nothingToApply && <p className="muted">The last check found no missing keywords or suggestions.</p>}
          </div>
        </details>
      )}
    </Card>
  );
}
