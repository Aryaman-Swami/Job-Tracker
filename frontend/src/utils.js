export const SOURCE = { AUTO: 'n8n', MANUAL: 'manual' };

export const STATUS_LABELS = {
  to_ask: 'To Ask',
  asked: 'Asked',
  applied: 'Applied',
  responded: 'Responded',
  declined: 'Declined',
  not_interested: 'Not Interested',
};
export const STATUS_OPTIONS = Object.entries(STATUS_LABELS);

export function buildReferralTemplate(job) {
  const name = job.contact_name || 'Name';
  const role = job.role || 'Role';
  const company = job.company || 'Company';
  const jobId = job.job_ref_id || 'N/A';
  const jobLink = job.job_url || 'N/A';
  return `Hi ${name},

Quick ask — I'm applying for a ${role} role at ${company} and a referral from you would genuinely boost my chances. I've put in the work to make sure I'm a strong fit, and I'd really appreciate the nudge.

Role: ${role}
Job ID: ${jobId}

Resume: https://drive.google.com/file/d/1ZmZlLaCHrwik0zV5ZaaLJxRCctKuaFUv/view?usp=sharing

Job link: ${jobLink}
Email: swamiaryaman21.as@gmail.com

A reply would be helpful :)`;
}

export function postedInfo(job) {
  const exact = !!job.date_posted;
  const dateStr = job.date_posted || job.created_at;
  if (!dateStr) return null;
  const posted = new Date(dateStr);
  if (isNaN(posted)) return null;

  const hoursAgo = (Date.now() - posted.getTime()) / 36e5;
  const verb = exact ? 'Posted' : 'Scraped';
  const label = hoursAgo < 1
    ? (exact ? 'Just posted' : 'Just scraped')
    : hoursAgo < 24
      ? `${verb} ${Math.round(hoursAgo)}h ago`
      : `${verb} ${Math.round(hoursAgo / 24)}d ago`;

  const cls = hoursAgo < 12 ? 'badge-fresh' : 'badge-posted';
  const dateLabel = posted.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  const title = exact ? dateLabel : `Exact posting date unavailable — showing scrape time instead: ${dateLabel}`;
  return { label, cls, title };
}

export function monthKey(dateStr) {
  return new Date(dateStr).toLocaleString('default', { month: 'long', year: 'numeric' });
}

export function dayKey(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d)) return 'Unknown date';

  const startOfDay = date => new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const daysAgo = Math.round((startOfDay(new Date()) - startOfDay(d)) / 864e5);

  if (daysAgo === 0) return 'Today';
  if (daysAgo === 1) return 'Yesterday';
  if (daysAgo > 1 && daysAgo < 7) return d.toLocaleString('default', { weekday: 'long' });
  return d.toLocaleString('default', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

export function postedTime(job) {
  const d = new Date(job.date_posted || job.created_at);
  return isNaN(d) ? 0 : d.getTime();
}

export function buildResumeFilename(company) {
  const clean = (company || '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return `Aryaman_Swami_Resume_${clean}.pdf`;
}

export function scoreClass(pct) {
  return pct >= 75 ? 'good' : pct >= 50 ? 'ok' : 'bad';
}

export function scoreColor(pct) {
  return pct >= 75 ? '#1a9455' : pct >= 50 ? '#d97706' : '#c0392b';
}
