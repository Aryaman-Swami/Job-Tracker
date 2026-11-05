import { STATUS_LABELS, STATUS_PILL, postedInfo, postedAgo, sourceLabel } from '../utils.js';

// One two-line row: company, job ID and posting age; then role, source, stage and match score.
export default function JobCard({ job, selected, tailoring, onSelect }) {
  const posted = postedInfo(job);
  const when = postedAgo(job);
  return (
    <button type="button" className="job-row" data-id={job.id} aria-current={selected ? 'true' : undefined}
      onClick={() => onSelect(job)}>
      <span className="job-line">
        <span className="job-company truncate">{job.company}</span>
        {job.job_ref_id && <span className="job-ref mono truncate">#{job.job_ref_id}</span>}
        {when && <span className="job-when" title={posted?.title}>{when}</span>}
      </span>
      <span className="job-line">
        <span className="job-role truncate">{job.role || '-'}</span>
        <span className="job-source">{sourceLabel(job.source)}</span>
        {tailoring
          ? <span className="job-busy"><span className="spinner" aria-hidden="true" />Tailoring…</span>
          : <span className={STATUS_PILL[job.status] || 'pill'}>{STATUS_LABELS[job.status] || job.status}</span>}
        <span className="job-match" title={job.ats_score != null ? `Match score ${job.ats_score} of 100` : 'No match score yet'}>
          {job.ats_score != null ? `Match ${job.ats_score}` : <span className="dash" aria-label="No match score">-</span>}
        </span>
      </span>
    </button>
  );
}
