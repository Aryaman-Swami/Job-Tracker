import { useEffect, useState } from 'react';
import { SOURCE } from '../utils.js';

const emptyForm = {
  company: '', role: '', jobRefId: '', contactName: '', contactEmail: '',
  jobUrl: '', linkedinUrl: '', needsReferral: false, description: '', notes: '',
};

export default function JobFormModal({ open, job, allJobs, onClose, onSubmit }) {
  const [form, setForm] = useState(emptyForm);
  const [roleMode, setRoleMode] = useState('select'); // 'select' | 'new'
  const [roleValue, setRoleValue] = useState('');
  const [roleNewValue, setRoleNewValue] = useState('');

  const uniqueRoles = [...new Set(allJobs.filter(j => j.source === SOURCE.MANUAL).map(j => j.role).filter(Boolean))].sort((a, b) => a.localeCompare(b));

  useEffect(() => {
    if (!open) return;
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
      setRoleMode('select'); setRoleValue(''); setRoleNewValue('');
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

  function handleSubmit(e) {
    e.preventDefault();
    const role = roleMode === 'new' ? roleNewValue.trim() : roleValue.trim();
    onSubmit({
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
  }

  return (
    <div className="modal" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box">
        <div className="modal-header">
          <h2>{job ? 'Edit Job' : 'Add Job'}</h2>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <label>Company *<input type="text" required placeholder="e.g. Google" value={form.company} onChange={set('company')} /></label>
            <label>Role *
              <select required value={roleValue} onChange={handleRoleSelectChange}>
                <option value="" disabled>Select a role…</option>
                {uniqueRoles.map(r => <option key={r} value={r}>{r}</option>)}
                <option value="__new__">+ Add new role…</option>
              </select>
              {roleMode === 'new' && (
                <input type="text" placeholder="Enter new role" required value={roleNewValue}
                  onChange={e => setRoleNewValue(e.target.value)} />
              )}
            </label>
          </div>
          <label>Job ID<input type="text" placeholder="e.g. REQ-12345" value={form.jobRefId} onChange={set('jobRefId')} /></label>
          <div className="form-row">
            <label>Contact Name<input type="text" placeholder="Referral contact" value={form.contactName} onChange={set('contactName')} /></label>
            <label>Contact Email<input type="email" placeholder="contact@company.com" value={form.contactEmail} onChange={set('contactEmail')} /></label>
          </div>
          <label>Job URL<input type="url" placeholder="https://..." value={form.jobUrl} onChange={set('jobUrl')} /></label>
          <div className="form-row">
            <label>LinkedIn URL<input type="url" placeholder="https://linkedin.com/in/..." value={form.linkedinUrl} onChange={set('linkedinUrl')} /></label>
            <label className="checkbox-label"><input type="checkbox" checked={form.needsReferral} onChange={set('needsReferral')} /> Needs Referral</label>
          </div>
          <label>Job Description<textarea rows={5} placeholder="Paste the job description here..." value={form.description} onChange={set('description')} /></label>
          <label>Notes<textarea rows={3} placeholder="Any notes..." value={form.notes} onChange={set('notes')} /></label>
          <div className="form-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary">Save</button>
          </div>
        </form>
      </div>
    </div>
  );
}
