import { useState } from 'react';

export default function TailorSection({ latex, note, tailoring, onTailor, onGeneratePdf, onAutoApply, applying, canApply }) {
  const [open, setOpen] = useState(!!latex);
  const [copyLabel, setCopyLabel] = useState('Copy');

  function copy() {
    navigator.clipboard.writeText(latex).then(() => {
      setCopyLabel('Copied!');
      setTimeout(() => setCopyLabel('Copy'), 2000);
    });
  }

  async function handleClick() {
    setOpen(false);
    await onTailor(null);
    setOpen(true);
  }

  return (
    <>
      <button className="btn-referral" onClick={handleClick} disabled={tailoring}>
        {tailoring ? '⏳ Tailoring with Claude…' : '✨ Tailor Resume with Claude'}
      </button>
      {canApply && (
        <button
          className="btn-referral"
          onClick={onAutoApply}
          disabled={applying}
          title="Opens a real Chrome window and fills this job's application (Workday, Naukri, LinkedIn, Indeed, Greenhouse, Lever, Wellfound, or best-effort for anything else) with the tailored resume — always stops before the final submit for you to review."
        >
          {applying ? '⏳ Launching Chrome…' : '🚀 Auto-Apply'}
        </button>
      )}
      {open && latex && (
        <div className="referral-box">
          <div className="referral-header">
            <span>Tailored Resume (LaTeX)</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className={`copy-btn${copyLabel === 'Copied!' ? ' copied' : ''}`} onClick={copy}>{copyLabel}</button>
              <button className="copy-btn" onClick={() => onGeneratePdf(latex)}>Generate PDF</button>
            </div>
          </div>
          {note && <div className="tailor-note">&#9888; {note}</div>}
          <pre className="template-text tailor-text">{latex}</pre>
        </div>
      )}
    </>
  );
}
