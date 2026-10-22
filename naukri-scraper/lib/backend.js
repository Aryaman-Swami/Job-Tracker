const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';

let cachedToken = null;

async function login() {
  if (cachedToken) return cachedToken;
  const res = await fetch(`${BACKEND_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: process.env.APP_USERNAME || 'admin',
      password: process.env.APP_PASSWORD || '',
    }),
  });
  if (!res.ok) throw new Error(`Backend login failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  cachedToken = data.token;
  return cachedToken;
}

// Naukri's Apply flow uses whatever's on your profile, not a per-application
// upload — so this pipeline keeps your PROFILE resume current using your
// saved base resume, rather than tailoring one per job like apply-bot does
// for sites with a real per-application upload step.
async function getBaseResumePdf() {
  const token = await login();
  const res = await fetch(`${BACKEND_URL}/api/resume`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`GET /api/resume failed: ${res.status}`);
  const { content } = await res.json();
  if (!content || !content.trim()) throw new Error('No base resume saved in Job Tracker yet.');

  const pdfRes = await fetch(`${BACKEND_URL}/api/pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ latex: content, filename: 'naukri_profile_resume' }),
  });
  if (!pdfRes.ok) {
    const err = await pdfRes.json().catch(() => ({}));
    throw new Error(`PDF generation failed: ${err.error || pdfRes.status}`);
  }
  return Buffer.from(await pdfRes.arrayBuffer());
}

const STATUS_MAP = { applied: 'applied', already_applied: 'applied' };
const NOTE_MAP = {
  applied: 'Auto-applied via Naukri',
  already_applied: 'Naukri: already applied',
  external: 'Naukri: apply on company site (external) - apply manually',
  expired: 'Naukri: posting expired',
  needs_input: 'Naukri: chatbot needs answers (see apply-bot/naukri-answers.json)',
  error: 'Naukri: auto-apply failed',
};

// Writes the apply outcome to the Job Tracker DB (creates the job if absent).
// Set NAUKRI_RECORD_BACKEND=0 to disable.
async function recordApplication(job, outcome) {
  if (process.env.NAUKRI_RECORD_BACKEND === '0') return;
  if (!NOTE_MAP[outcome]) return; // session/limit: transient, nothing to record
  const token = await login();
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const status = STATUS_MAP[outcome] || 'to_ask';
  const notes = NOTE_MAP[outcome];
  const refId = (job.job_url.match(/(\d{8,})/) || [])[1] || null;

  const res = await fetch(`${BACKEND_URL}/api/jobs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ job_ref_id: refId, company: job.company, role: job.role, job_url: job.job_url, status, source: 'naukri', notes }),
  });
  if (!res.ok) throw new Error(`POST /api/jobs ${res.status}`);
  const body = await res.json();
  if (!body.skipped) return;

  // Already in the DB (dedup) -> find it and update the status/notes.
  const list = await (await fetch(`${BACKEND_URL}/api/jobs?status=all`, { headers })).json();
  const existing = list.find((j) => j.job_url === job.job_url || (refId && j.job_ref_id === refId));
  if (!existing) return;
  const patch = { notes };
  if (STATUS_MAP[outcome]) patch.status = status;
  await fetch(`${BACKEND_URL}/api/jobs/${existing.id}`, { method: 'PATCH', headers, body: JSON.stringify(patch) });
}

module.exports = { getBaseResumePdf, recordApplication };
