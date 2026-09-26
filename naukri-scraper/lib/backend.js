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

// Mirrors JobController's insert shape and its ON CONFLICT DO NOTHING dedup
// on job_url — same as scraper/run_scraper.py's post-and-check-skipped.
async function postJob(job) {
  const token = await login();
  const res = await fetch(`${BACKEND_URL}/api/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(job),
  });
  if (!res.ok) throw new Error(`POST /api/jobs failed: ${res.status}`);
  const data = await res.json();
  return !data.skipped;
}

module.exports = { postJob };
