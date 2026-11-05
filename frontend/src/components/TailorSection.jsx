import { useState } from 'react';
import Card from './Card.jsx';

// The resume tailored for this job. The Tailor resume action itself is the primary button
// in the job header; this card shows the result, its progress and its PDF.
export default function TailorSection({ company, latex, skillsMatch, note, tailoring, error, onRetry, onGeneratePdf, pdfBusy, pdfError }) {
  const [copyLabel, setCopyLabel] = useState('Copy LaTeX');

  function copy() {
    navigator.clipboard.writeText(latex).then(() => {
      setCopyLabel('Copied');
      setTimeout(() => setCopyLabel('Copy LaTeX'), 2000);
    });
  }

  return (
    <Card
      title="Tailored resume"
      actions={latex && !tailoring ? (
        <>
          <button type="button" className="btn ghost" onClick={copy} aria-live="polite">{copyLabel}</button>
          <button type="button" className="btn" onClick={() => onGeneratePdf(latex)} disabled={pdfBusy} aria-busy={pdfBusy}>
            {pdfBusy && <span className="spinner" aria-hidden="true" />}
            {pdfBusy ? 'Building PDF…' : 'Generate PDF'}
          </button>
        </>
      ) : null}
    >
      {tailoring && (
        <p className="job-busy" role="status"><span className="spinner" aria-hidden="true" />Tailoring your resume for {company}…</p>
      )}
      {error && !tailoring && (
        <p className="error-line" role="alert">
          Tailoring failed: {error}
          <button type="button" className="link-btn" onClick={onRetry}>Try again</button>
        </p>
      )}
      {pdfError && (
        <p className="error-line" role="alert">{pdfError}</p>
      )}
      {!latex && !tailoring && !error && (
        <p className="muted">Not tailored yet. Tailor resume rewrites your base resume for this posting.</p>
      )}
      {latex && !tailoring && (
        <>
          {Array.isArray(skillsMatch) && skillsMatch.length > 0 && (
            <div>
              <div className="kw-title">Key skills matched</div>
              <div className="chips">{skillsMatch.map((s, i) => <span className="chip" key={i}>{s}</span>)}</div>
            </div>
          )}
          {note && <p className="notice">{note}</p>}
          <pre className="well-text code">{latex}</pre>
        </>
      )}
    </Card>
  );
}
