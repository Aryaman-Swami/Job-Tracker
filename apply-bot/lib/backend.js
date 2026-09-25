const fetch = require('node-fetch');

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

async function authedFetch(path, opts = {}) {
  const token = await login();
  const res = await fetch(`${BACKEND_URL}${path}`, {
    ...opts,
    headers: {
      ...(opts.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  });
  return res;
}

async function getJob(id) {
  const res = await authedFetch('/api/jobs?status=all');
  if (!res.ok) throw new Error(`Failed to list jobs: ${res.status}`);
  const jobs = await res.json();
  const job = jobs.find((j) => String(j.id) === String(id));
  if (!job) throw new Error(`Job ${id} not found`);
  return job;
}

async function ensureTailoredLatex(id) {
  const job = await getJob(id);
  if (job.tailored_resume_latex && job.tailored_resume_latex.trim()) {
    return job.tailored_resume_latex;
  }
  console.log('No tailored resume on file yet — generating one from the job description...');
  const res = await authedFetch(`/api/tailor/${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(`Tailoring failed: ${data.error || res.status}`);
  return data.latex;
}

async function renderPdf(latex, filename) {
  const res = await authedFetch('/api/pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ latex, filename }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(`PDF generation failed: ${data.error || res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

module.exports = { getJob, ensureTailoredLatex, renderPdf };
