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

module.exports = { getBaseResumePdf };
