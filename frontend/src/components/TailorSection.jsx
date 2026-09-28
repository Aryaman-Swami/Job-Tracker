import { useState } from 'react';

export default function TailorSection({ latex, skillsMatch, note, tailoring, onTailor, onGeneratePdf, onAutoApply, applying, onRemoteApply, remoteApplying, canApply }) {
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
      {canApply && (
        <button
          className="btn-referral"
          onClick={onRemoteApply}
          disabled={remoteApplying}
          title="Fills the application headlessly on Render (no browser opens here) and sends a screenshot to your phone via ntfy — approve or discard from a link in that notification. Only Workday/LinkedIn/Indeed/Greenhouse/Lever support the remote-submit step; other sites just get filled/checked and you finish them yourself."
        >
          {remoteApplying ? '⏳ Sending to Render…' : '📱 Auto-Apply (Remote)'}
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
      {open && Array.isArray(skillsMatch) && skillsMatch.length > 0 && (
        <div className="referral-box">
          <div className="referral-header">
            <span>Key Skills Match</span>
          </div>
          <div className="skills-match-list">
            {skillsMatch.map((skill, i) => (
              <span className="skills-match-pill" key={i}>{skill}</span>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
