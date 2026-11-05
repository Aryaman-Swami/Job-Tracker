import { useEffect, useState } from 'react';
import { SOURCE } from '../utils.js';
import { useDialog } from '../hooks.js';

const emptyForm = {
  company: '', role: '', jobRefId: '', contactName: '', contactEmail: '',
  jobUrl: '', linkedinUrl: '', needsReferral: false, description: '', notes: '',
};

export default function JobFormModal({ open, job, allJobs, onClose, onSubmit }) {
  const [form, setForm] = useState(emptyForm);
  const [roleMode, setRoleMode] = useState('select'); // 'select' | 'new'
  const [roleValue, setRoleValue] = useState('');
  const [roleNewValue, setRoleNewValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const ref = useDialog(open, onClose);

  const uniqueRoles = [...new Set(allJobs.filter(j => j.source === SOURCE.MANUAL).map(j => j.role).filter(Boolean))].sort((a, b) => a.localeCompare(b));

  useEffect(() => {
    if (!open) return;
    setError(null); setSaving(false);
    if (job) {
      setForm({
        company: job.company || '', role: job.role || '', jobRefId: job.job_ref_id || '',
        contactName: job.contact_name || '', contactEmail: job.contact_email || '',
        jobUrl: job.job_url || '', linkedinUrl: job.linkedin_profile_url || '',
        needsReferral: job.needs_referral || false, description: job.description || '', notes: job.notes || '',
      });
      if (job.role && uniqueRoles.includes(job.role)) {
        setRoleMode('select'); setRoleValue(job.role); setRoleNewValue('');
      } else if (job.role) {
        setRoleMode('new'); setRoleValue('__new__'); setRoleNewValue(job.role);
      } else {
        setRoleMode('select'); setRoleValue(''); setRoleNewValue('');
      }
    } else {
      setForm(emptyForm);
      // With no saved roles yet, go straight to typing one.
      setRoleMode(uniqueRoles.length ? 'select' : 'new'); setRoleValue(uniqueRoles.length ? '' : '__new__'); setRoleNewValue('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, job]);

  if (!open) return null;

  function set(field) {
    return e => setForm(f => ({ ...f, [field]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  }

  function handleRoleSelectChange(e) {
    const v = e.target.value;
    setRoleValue(v);
    setRoleMode(v === '__new__' ? 'new' : 'select');
    if (v !== '__new__') setRoleNewValue('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const role = roleMode === 'new' ? roleNewValue.trim() : roleValue.trim();
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        id: job?.id,
        company: form.company.trim(),
        role,
        job_ref_id: form.jobRefId.trim() || null,
        contact_name: form.contactName.trim() || null,
        contact_email: form.contactEmail.trim() || null,
        job_url: form.jobUrl.trim() || null,
        linkedin_profile_url: form.linkedinUrl.trim() || null,
        needs_referral: form.needsReferral,
        description: form.description.trim() || null,
        notes: form.notes.trim() || null,
      });
    } catch {
      setError('The job was not saved. Check your connection and try again.');
      setSaving(false);
    }
  }

  const title = job ? 'Edit job' : 'Add job';
  return (
    <div className="modal" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="modal-box" role="dialog" aria-modal="true" aria-labelledby="job-form-title" ref={ref} tabIndex={-1} onSubmit={handleSubmit}>
        <div className="modal-head">
          <h2 id="job-form-title">{title}</h2>
          <button type="button" className="btn ghost icon-btn" aria-label="Close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body form-grid">
          <div className="form-row">
            <label className="field-label"><span>Company</span>
              <input className="control" type="text" required placeholder="Company name" value={form.company} onChange={set('company')} data-autofocus />
            </label>
            <div className="field-label">
              <label htmlFor="job-role">Role</label>
              {uniqueRoles.length > 0 && (
                <select id="job-role" className="control" required={roleMode === 'select'} value={roleValue} onChange={handleRoleSelectChange}>
                  <option value="" disabled>Choose a role</option>
                  {uniqueRoles.map(r => <option key={r} value={r}>{r}</option>)}
                  <option value="__new__">New role…</option>
                </select>
              )}
              {roleMode === 'new' && (
                <input id={uniqueRoles.length ? undefined : 'job-role'} className="control" type="text" placeholder="e.g. Backend Engineer" required
                  aria-label={uniqueRoles.length ? 'New role' : undefined} value={roleNewValue} onChange={e => setRoleNewValue(e.target.value)} />
              )}
            </div>
          </div>
          <div className="form-row">
            <label className="field-label"><span>Job ID</span>
              <input className="control mono" type="text" placeholder="e.g. REQ-12345" value={form.jobRefId} onChange={set('jobRefId')} />
            </label>
            <label className="field-label"><span>Job URL</span>
              <input className="control" type="url" placeholder="https://" value={form.jobUrl} onChange={set('jobUrl')} />
            </label>
          </div>
          <div className="form-row">
            <label className="field-label"><span>Contact name</span>
              <input className="control" type="text" placeholder="Who could refer you" value={form.contactName} onChange={set('contactName')} />
            </label>
            <label className="field-label"><span>Contact email</span>
              <input className="control" type="email" placeholder="name@company.com" value={form.contactEmail} onChange={set('contactEmail')} />
            </label>
          </div>
          <label className="field-label"><span>LinkedIn URL</span>
            <input className="control" type="url" placeholder="https://linkedin.com/in/" value={form.linkedinUrl} onChange={set('linkedinUrl')} />
          </label>
          <label className="switch-row">
            <span>Needs a referral</span>
            <input type="checkbox" role="switch" className="switch" checked={form.needsReferral} aria-checked={form.needsReferral} onChange={set('needsReferral')} />
          </label>
          <label className="field-label"><span>Job description</span>
            <textarea className="control" rows={6} placeholder="Paste the job description" value={form.description} onChange={set('description')} />
          </label>
          <label className="field-label"><span>Notes</span>
            <textarea className="control" rows={3} placeholder="Anything to remember" value={form.notes} onChange={set('notes')} />
          </label>
          {error && <p className="error-line" role="alert">{error}</p>}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={saving} aria-busy={saving}>{saving ? 'Saving…' : 'Save job'}</button>
        </div>
      </form>
    </div>
  );
}
