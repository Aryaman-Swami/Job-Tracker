import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { SOURCE, STATUS_LABELS } from '../utils.js';
import { ReferralMessageSection, LinkedinHelperSection } from './ReferralSection.jsx';
import TailorSection from './TailorSection.jsx';
import AtsSection from './AtsSection.jsx';
import HackerRankSection from './HackerRankSection.jsx';

function buildDetailRows(job) {
  const rows = [
    { label: 'Status', value: <span className={`badge badge-${job.status}`}>{STATUS_LABELS[job.status] || job.status}</span> },
    { label: 'Source', value: job.source === SOURCE.AUTO ? 'Auto-fetched' : 'Manual' },
    { label: 'Added', value: new Date(job.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) },
  ];
  rows.splice(-1, 0, { label: 'Posted', value: job.date_posted || job.created_at ? new Date(job.date_posted || job.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Unknown' });
  if (job.contact_name) rows.splice(1, 0, { label: 'Contact', value: job.contact_name });
  if (job.contact_email) rows.splice(2, 0, { label: 'Email', value: <a href={`mailto:${job.contact_email}`}>{job.contact_email}</a> });
  if (job.needs_referral) rows.splice(1, 0, { label: 'Referral', value: <span className="badge badge-referral">Needed</span> });
  if (job.job_ref_id) rows.splice(-2, 0, { label: 'Job ID', value: job.job_ref_id });
  if (job.job_url) rows.splice(-2, 0, { label: 'Link', value: <a href={job.job_url} target="_blank" rel="noopener noreferrer">View Posting &#8599;</a> });
  if (job.linkedin_profile_url) rows.splice(-2, 0, { label: 'LinkedIn', value: <a href={job.linkedin_profile_url} target="_blank" rel="noopener noreferrer">View Profile &#8599;</a> });
  if (job.notes) rows.splice(-1, 0, { label: 'Notes', value: job.notes });
  return rows;
}

export default function DetailPanel({ job, onClose, onJobUpdated, onOpenPdfPreview }) {
  const [tailoring, setTailoring] = useState(false);
  const [tailorNote, setTailorNote] = useState(null);
  const [applying, setApplying] = useState(false);

  const [atsResult, setAtsResult] = useState(null);
  const [atsLoading, setAtsLoading] = useState(false);

  const [hrResult, setHrResult] = useState(null);
  const [hrLoading, setHrLoading] = useState(false);

  useEffect(() => {
    setTailorNote(null);
    setHrResult(null);
    setAtsResult(null);
    if (!job) return;

    if (job.ats_score != null) {
      setAtsResult({
        score: job.ats_score,
        breakdown: job.ats_breakdown,
        matched_keywords: job.ats_matched_keywords,
        missing_keywords: job.ats_missing_keywords,
        suggestions: job.ats_suggestions,
      });
    }
  }, [job?.id]);

  if (!job) {
    return (
      <aside className="detail-panel">
        <div className="panel-empty"><span>&#8592; Select a job to view details</span></div>
      </aside>
    );
  }

  async function runTailor(atsFeedback) {
    setTailoring(true);
    try {
      const data = await api.tailor(job.id, atsFeedback);
      if (data.ok) {
        onJobUpdated(job.id, { tailored_resume_latex: data.latex });
        setTailorNote(data.note || null);
      } else {
        alert(data.error || 'Tailoring failed.');
      }
    } catch {
      alert('Request failed.');
    }
    setTailoring(false);
  }

  async function runAutoApply() {
    setApplying(true);
    try {
      const data = await api.autoApply(job.id);
      if (data.ok) {
        alert(data.message || 'Chrome is launching — review and submit the application in that window.');
      } else {
        alert(data.error || 'Auto-apply failed to launch.');
      }
    } catch {
      alert('Could not reach the apply-bot helper on your machine. Start it with "npm run serve" in the apply-bot folder, then try again.');
    }
    setApplying(false);
  }

  async function runAtsScore() {
    setAtsLoading(true);
    try {
      const data = await api.runAtsScore(job.id);
      if (data.ok) {
        const result = {
          score: data.score, breakdown: data.breakdown,
          matched_keywords: data.matched_keywords, missing_keywords: data.missing_keywords,
          suggestions: data.suggestions,
        };
        setAtsResult(result);
        onJobUpdated(job.id, {
          ats_score: data.score, ats_breakdown: data.breakdown,
          ats_matched_keywords: data.matched_keywords, ats_missing_keywords: data.missing_keywords,
          ats_suggestions: data.suggestions,
        });
      } else {
        alert(data.error || 'ATS analysis failed.');
      }
    } catch {
      alert('Request failed.');
    }
    setAtsLoading(false);
  }

  async function runHackerRankScore() {
    setHrLoading(true);
    try {
      const data = await api.runHackerRankScore(job.id);
      if (data.ok) setHrResult(data);
      else alert(data.error || 'HackerRank scoring failed.');
    } catch {
      alert('Request failed.');
    }
    setHrLoading(false);
  }

  async function handleGeneratePdf(latex) {
    const baseName = ('Aryaman_Swami_Resume_' + (job.company || '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')).replace(/_+$/, '');
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
        alert(`${data.error}\n\nDownloaded as .tex instead — you can compile it on Overleaf if needed.`);
      }
    } catch {
      alert('Request failed.');
    }
  }

  return (
    <aside className="detail-panel">
      <div className="panel-content">
        <div className="panel-header">
          <div className="panel-heading">
            <div className="panel-title">{job.company}</div>
            <div className="panel-subtitle">{job.role}</div>
          </div>
          <button className="close-panel" onClick={onClose}>&times;</button>
        </div>

        <div className="detail-rows">
          {buildDetailRows(job).map((r, i) => (
            <div className="detail-row" key={i}>
              <span className="detail-label">{r.label}</span>
              <span className="detail-value">{r.value}</span>
            </div>
          ))}
        </div>

        <ReferralMessageSection job={job} />
        <LinkedinHelperSection job={job} />
        <TailorSection
          latex={job.tailored_resume_latex}
          note={tailorNote}
          tailoring={tailoring}
          onTailor={runTailor}
          onGeneratePdf={handleGeneratePdf}
          onAutoApply={runAutoApply}
          applying={applying}
          canApply={!!job.job_url}
        />
        <AtsSection
          atsResult={atsResult}
          loading={atsLoading}
          onRun={runAtsScore}
          onApplyGaps={runTailor}
        />
        <HackerRankSection result={hrResult} loading={hrLoading} onRun={runHackerRankScore} />
      </div>
    </aside>
  );
}
