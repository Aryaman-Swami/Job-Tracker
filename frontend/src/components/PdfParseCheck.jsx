import { useState } from 'react';
import { api } from '../api.js';

// "Can an ATS read this PDF?" Runs only when asked: it compiles the resume and reads its
// text layer on the server, with no Claude call, and never touches the tailor request.
export default function PdfParseCheck({ jobId }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.checkPdfText(jobId);
      if (data.ok) setResult(data);
      else setError(data.error || 'Check failed');
    } catch (e) {
      setError(e.message || 'Check failed');
    } finally {
      setLoading(false);
    }
  }

  const lost = result?.keywords_lost_in_pdf || [];

  return (
    <details className="disclosure">
      <summary>PDF parse check</summary>
      <div className="disclosure-body">
        <p className="muted">Reads the compiled PDF's text layer the way an ATS parser does. No Claude call.</p>
        <div>
          <button type="button" className="btn" onClick={run} disabled={loading} aria-busy={loading}>
            {loading && <span className="spinner" aria-hidden="true" />}
            {loading ? 'Checking…' : result ? 'Re-run' : 'Check PDF'}
          </button>
        </div>
        {error && <p className="error-line" role="alert">{error}</p>}
        {result && (
          <>
            <p><strong>{result.passed ? 'A parser reads this resume correctly.' : 'A parser may misread this resume.'}</strong></p>
            <ul>
              {result.checks.map(c => (
                <li key={c.name}>{c.ok ? '✓' : '✗'} {c.name}: <span className="muted">{c.detail}</span></li>
              ))}
            </ul>
            {lost.length > 0 && (
              <p>Scored as matched but not found in the PDF text: {lost.join(', ')}</p>
            )}
          </>
        )}
      </div>
    </details>
  );
}
