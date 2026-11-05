import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { STATUS_OPTIONS, companyTint, initials, postedInfo, sourceLabel } from '../utils.js';
import { prefersReducedMotion } from '../hooks.js';
import { ReferralMessageSection, LinkedinHelperSection } from './ReferralSection.jsx';
import TailorSection from './TailorSection.jsx';
import AtsSection from './AtsSection.jsx';
import Card from './Card.jsx';

const day = d => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const Dash = () => <span className="dash" aria-label="Not set">-</span>;

function detailRows(job) {
  return [
    ['Referral', job.needs_referral ? <span className="pill warn">Needed</span> : 'Not needed'],
    ['Contact', job.contact_name || <Dash />],
    ['Email', job.contact_email ? <a href={`mailto:${job.contact_email}`}>{job.contact_email}</a> : <Dash />],
    ['LinkedIn', job.linkedin_profile_url ? <a href={job.linkedin_profile_url} target="_blank" rel="noopener noreferrer">View profile</a> : <Dash />],
    ['Source', job.source === 'manual' ? 'Added by me' : sourceLabel(job.source)],
    ['Posted', job.date_posted ? day(job.date_posted) : <span className="muted">Not given</span>],
    ['Added', job.created_at ? day(job.created_at) : <Dash />],
    ['Job ID', job.job_ref_id ? <span className="mono">{job.job_ref_id}</span> : <Dash />],
    ['Notes', job.notes || <Dash />],
  ];
}

export default function DetailPanel({ job, overlay, onClose, onJobUpdated, onOpenPdfPreview, tailoring, tailorError, onTailor, onEdit, onDelete, onStatusChange }) {
  const [atsResult, setAtsResult] = useState(null);
  const [prevScore, setPrevScore] = useState(null);
  const [atsLoading, setAtsLoading] = useState(false);
  const [atsError, setAtsError] = useState(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState(null);
  const [descCopy, setDescCopy] = useState('Copy');
  const [closing, setClosing] = useState(false);
  const headingRef = useRef(null);

  useEffect(() => {
    setAtsResult(null); setPrevScore(null); setAtsError(null); setPdfError(null); setClosing(false);
    if (!job) return;
    if (job.ats_score != null) {
      setAtsResult({
        score: job.ats_score, breakdown: job.ats_breakdown, matched_keywords: job.ats_matched_keywords,
        missing_keywords: job.ats_missing_keywords, suggestions: job.ats_suggestions,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id]);

  // On a phone the open job is a pushed full-screen view: focus its heading, lock the
  // list behind it, and let Escape go back.
  useEffect(() => {
    if (!overlay || !job) return undefined;
    headingRef.current?.focus();
    document.body.classList.add('has-overlay');
    const onKey = e => { if (e.key === 'Escape' && !document.querySelector('.modal, .sheet')) back(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); document.body.classList.remove('has-overlay'); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlay, job?.id]);

  function back() {
    if (prefersReducedMotion()) { onClose(); return; }
    setClosing(true);
    setTimeout(onClose, 220);
  }

  if (!job) {
    return (
      <aside className="detail" aria-label="Open job">
        <div className="panel detail-empty">
          <p>Choose a job to see its match score, referral message and tailored resume.</p>
        </div>
      </aside>
    );
  }

  const runTailor = atsFeedback => onTailor(job.id, atsFeedback);
  const posted = postedInfo(job);

  async function runAtsScore() {
    setAtsLoading(true);
    setAtsError(null);
    try {
      const data = await api.runAtsScore(job.id);
      if (data.ok) {
        if (atsResult) setPrevScore(atsResult.score);
        setAtsResult({
          score: data.score, breakdown: data.breakdown, matched_keywords: data.matched_keywords,
          missing_keywords: data.missing_keywords, suggestions: data.suggestions,
        });
        onJobUpdated(job.id, {
          ats_score: data.score, ats_breakdown: data.breakdown, ats_matched_keywords: data.matched_keywords,
          ats_missing_keywords: data.missing_keywords, ats_suggestions: data.suggestions,
        });
      } else {
        setAtsError(data.error || 'the analysis did not finish.');
      }
    } catch {
      setAtsError('the request did not reach the server.');
    }
    setAtsLoading(false);
  }

  async function handleGeneratePdf(latex) {
    const baseName = ('Aryaman_Swami_Resume_' + (job.company || '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')).replace(/_+$/, '');
    setPdfBusy(true);
    setPdfError(null);
    try {
      const res = await api.generatePdf(latex, baseName);
      if (res.ok) {
        const blob = await res.blob();
        onOpenPdfPreview(blob, `${baseName}.pdf`, latex, job.id, job.company);
      } else {
        const data = await res.json();
        const blob = new Blob([latex], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${baseName}.tex`;
        a.click();
        URL.revokeObjectURL(url);
        setPdfError(`${data.error || 'The PDF did not compile.'} Downloaded the .tex instead, so you can compile it on Overleaf.`);
      }
    } catch {
      setPdfError('The PDF request did not reach the server. Try again.');
    }
    setPdfBusy(false);
  }

  function copyDescription() {
    navigator.clipboard.writeText(job.description).then(() => {
      setDescCopy('Copied');
      setTimeout(() => setDescCopy('Copy'), 2000);
    });
  }

  return (
    <aside className={`detail${overlay ? ' open' : ''}${closing ? ' closing' : ''}`} aria-label={`${job.company}, open job`}>
      <div className="detail-bar">
        <button type="button" className="btn ghost" onClick={back}>Back to jobs</button>
        <span className="truncate">{job.company}</span>
      </div>

      <section className="panel">
        <div className="job-head-top">
          <span className="initials" style={companyTint(job.company)} aria-hidden="true">{initials(job.company)}</span>
          <div className="job-head-text">
            <h2 className="job-title" ref={headingRef} tabIndex={-1}>{job.company}</h2>
            <p className="job-sub">
              {job.role || 'Role not given'}
              {posted ? ` · ${posted.label}` : ''}
              {job.source !== 'manual' ? ` on ${sourceLabel(job.source)}` : ''}
            </p>
          </div>
        </div>
        <div className="job-actions">
          <label className="sr-only" htmlFor={`stage-${job.id}`}>Stage</label>
          <select id={`stage-${job.id}`} className="control stage-select" data-status={job.status} value={job.status}
            onChange={e => onStatusChange(job, e.target.value)}>
            {STATUS_OPTIONS.map(([val, label]) => <option key={val} value={val}>{label}</option>)}
          </select>
          <button type="button" className="btn primary" onClick={() => runTailor(null)} disabled={tailoring} aria-busy={tailoring}>
            {tailoring && <span className="spinner" aria-hidden="true" />}
            {tailoring ? 'Tailoring…' : job.tailored_resume_latex ? 'Tailor again' : 'Tailor resume'}
          </button>
          {job.job_url && <a className="btn" href={job.job_url} target="_blank" rel="noopener noreferrer">Open posting</a>}
          <button type="button" className="btn" onClick={() => onEdit(job)}>Edit</button>
          <button type="button" className="btn ghost danger" onClick={() => onDelete(job)}>Delete</button>
        </div>
      </section>

      <div className="detail-grid">
        <div className="detail-main">
          <AtsSection
            atsResult={atsResult}
            prevScore={prevScore}
            loading={atsLoading}
            error={atsError}
            onRun={runAtsScore}
            onApplyGaps={runTailor}
            tailoring={tailoring}
          />
          <TailorSection
            company={job.company}
            latex={job.tailored_resume_latex}
            skillsMatch={job.tailored_skills_match}
            note={job._tailor_note}
            tailoring={tailoring}
            error={tailorError}
            onRetry={() => runTailor(null)}
            onGeneratePdf={handleGeneratePdf}
            pdfBusy={pdfBusy}
            pdfError={pdfError}
          />
          <ReferralMessageSection job={job} onMarkAsked={() => onStatusChange(job, 'asked')} />
          <LinkedinHelperSection job={job} />
          {job.description && (
            <Card title="Job description" collapsible defaultOpen={false}
              actions={<button type="button" className="btn ghost" onClick={copyDescription} aria-live="polite">{descCopy}</button>}>
              <pre className="well-text">{job.description}</pre>
            </Card>
          )}
        </div>

        <section className="panel detail-side" aria-label="Details">
          <h3>Details</h3>
          <div className="kv">
            {detailRows(job).map(([label, value]) => (
              <div className="kv-row" key={label}>
                <span className="kv-label">{label}</span>
                <span className="kv-value">{value}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </aside>
  );
}
