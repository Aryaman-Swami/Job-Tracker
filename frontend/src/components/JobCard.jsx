import { SOURCE, STATUS_OPTIONS, postedInfo } from '../utils.js';
import { AtsMiniBadge } from './AtsScoreCard.jsx';

export default function JobCard({ job, selected, onSelect, onEdit, onDelete, onStatusChange }) {
  const posted = postedInfo(job);

  return (
    <div className={`job-card${selected ? ' selected' : ''}`} data-id={job.id}
      onClick={e => {
        if (e.target.closest('.icon-btn, .apply-btn, .status-select')) return;
        onSelect(selected ? null : job);
      }}>
      <div className="job-card-body">
        <div className="job-card-title">
          {job.company}
          {job.job_ref_id ? <span className="job-ref-id">#{job.job_ref_id}</span> : null}
        </div>
        <div className="job-card-sub">{job.role}</div>
        <div className="job-card-meta">
          {job.contact_name && <span>&#128100; {job.contact_name}</span>}
          {job.contact_email && <a href={`mailto:${job.contact_email}`}>&#9993; {job.contact_email}</a>}
          {job.job_url && <a href={job.job_url} target="_blank" rel="noopener noreferrer">&#128279; Job Posting</a>}
          {job.linkedin_profile_url && <a href={job.linkedin_profile_url} target="_blank" rel="noopener noreferrer">&#128100; LinkedIn</a>}
        </div>
        {job.notes && <div className="job-notes">{job.notes}</div>}
      </div>

      <div className="job-card-actions">
        <AtsMiniBadge score={job.ats_score} />
        {posted && <span className={`badge ${posted.cls}`} title={posted.title}>{posted.label}</span>}
        {job.needs_referral && <span className="badge badge-referral" title="Referral needed">Referral</span>}
        {job.source === SOURCE.AUTO && <span className="badge badge-auto" title="Auto-fetched">Auto</span>}
        <select
          className={`status-select status-${job.status}`}
          value={job.status}
          onClick={e => e.stopPropagation()}
          onChange={e => onStatusChange(job, e.target.value)}
        >
          {STATUS_OPTIONS.map(([val, label]) => <option key={val} value={val}>{label}</option>)}
        </select>
        {job.job_url && <a className="apply-btn" href={job.job_url} target="_blank" rel="noopener noreferrer">Apply</a>}
        <button className="icon-btn edit" title="Edit" onClick={() => onEdit(job)}>&#9998;</button>
        <button className="icon-btn del" title="Delete" onClick={() => onDelete(job.id)}>&#128465;</button>
      </div>
    </div>
  );
}
