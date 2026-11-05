export const SOURCE = { AUTO: 'n8n', MANUAL: 'manual' };

export const STATUS_LABELS = {
  to_ask: 'To ask',
  asked: 'Asked',
  applied: 'Applied',
  responded: 'Responded',
  declined: 'Declined',
  not_interested: 'Not interested',
};

// The stages the pipeline strip counts. "Not interested" is hidden from the list by the API.
export const PIPELINE_STAGES = ['to_ask', 'asked', 'applied', 'responded', 'declined'];

// Pale pill pair per stage (classes defined in styles.css).
export const STATUS_PILL = {
  to_ask: 'pill', asked: 'pill warn', applied: 'pill applied',
  responded: 'pill pos', declined: 'pill neg', not_interested: 'pill quiet',
};

const SOURCE_NAMES = {
  n8n: 'Scraped', linkedin: 'LinkedIn', workday: 'Workday', naukri: 'Naukri', instahyre: 'Instahyre',
  'google-search': 'Google', adzuna: 'Adzuna', manual: 'Manual',
};
export function sourceLabel(source) {
  if (!source) return 'Unknown';
  return SOURCE_NAMES[source] || source.charAt(0).toUpperCase() + source.slice(1).replace(/[-_]/g, ' ');
}

// Posted time in words, short form for a list row's right slot ("9 min", "5 h", "2 d").
export function postedShort(job) {
  const d = new Date(job.date_posted || job.created_at);
  if (isNaN(d)) return null;
  const mins = (Date.now() - d.getTime()) / 6e4;
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${Math.round(mins)} min`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h`;
  return `${Math.round(mins / 1440)} d`;
}

// The same age with its baseline named: "posted 59 min ago", or "scraped 2 h ago" when the
// source gave no posting date and the scrape time stands in.
export function postedAgo(job) {
  const short = postedShort(job);
  if (!short) return null;
  const verb = job.date_posted ? 'posted' : 'scraped';
  return short === 'Just now' ? `${verb} just now` : `${verb} ${short} ago`;
}

// Day-group heading for the list, which groups by the day a job was added.
export function addedDayLabel(dateStr) {
  const key = dayKey(dateStr);
  if (key === 'Today' || key === 'Yesterday') return `Added ${key.toLowerCase()}`;
  if (key === 'Unknown date') return 'Added on an unknown date';
  return `Added ${key}`;
}

// A stable pale tint per company for its initials disc: identity, never data.
export function companyTint(name = '') {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return { background: `hsl(${h} 55% 93%)` };
}
export function initials(name = '') {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] || '') + (words[1]?.[0] || '')).toUpperCase() || '?';
}
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
      ? `${verb} ${Math.round(hoursAgo)} h ago`
      : `${verb} ${Math.round(hoursAgo / 24)} d ago`;

  const cls = hoursAgo < 12 ? 'badge-fresh' : 'badge-posted';
  const dateLabel = posted.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  const title = exact ? dateLabel : `Exact posting date unavailable, showing scrape time instead: ${dateLabel}`;
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

