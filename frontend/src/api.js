import { getToken, logout } from './auth.js';

const JOBS = '/api/jobs';

// Endpoints that call the Claude CLI (tailor, ATS score, HackerRank score) or
// run a LaTeX compile (pdf) can take well past Netlify's ~26s proxy-redirect
// timeout, especially after a Render free-tier cold start, which returns a
// 504 to the browser even though the Render backend is still working. Call
// the Render backend directly for these — CORS already allows it via
// FRONTEND_ORIGIN (see backend WebConfig) — instead of going through the
// Netlify /api/* redirect in netlify.toml.
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'https://job-tracker-g8bx.onrender.com';

async function authFetch(url, options = {}) {
  const token = getToken();
  if (!token) {
    logout();
    throw new Error('Not logged in');
  }
  const headers = { ...(options.headers || {}), Authorization: `Bearer ${token}` };
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    logout();
    throw new Error('Session expired');
  }
  return res;
}

// Starts a long Claude-backed job on the backend and polls for the result,
// instead of holding one HTTP connection open for minutes. Mobile browsers
// drop that connection when the screen turns off; polling survives it
// (failed polls are just retried, and we poll immediately on wake-up).
async function runAsync(path, body) {
  const startRes = await authFetch(`${BACKEND_URL}/api/async/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const { taskId } = await startRes.json();
  const deadline = Date.now() + 10 * 60 * 1000;

  return new Promise((resolve, reject) => {
    let timer;
    let polling = false;
    const cleanup = () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
    const poll = async () => {
      if (polling) return;
      polling = true;
      clearTimeout(timer);
      try {
        const res = await authFetch(`${BACKEND_URL}/api/async/task/${taskId}`);
        if (res.status === 404) { cleanup(); return reject(new Error('Task expired')); }
        const data = await res.json();
        if (data.done) { cleanup(); return resolve(data.body); }
      } catch (e) {
        if (e.message === 'Session expired' || e.message === 'Not logged in') { cleanup(); return reject(e); }
        // network blip (e.g. screen was off) — keep trying
      } finally {
        polling = false;
      }
      if (Date.now() > deadline) { cleanup(); return reject(new Error('Timed out waiting for result')); }
      timer = setTimeout(poll, 3000);
    };
    const onVisible = () => { if (document.visibilityState === 'visible') poll(); };
    document.addEventListener('visibilitychange', onVisible);
    poll();
  });
}

async function json(res) {
  return res.json();
}

export const api = {
  listJobs(params) {
    return authFetch(`${JOBS}?${new URLSearchParams(params)}`).then(json);
  },
  createJob(body) {
    return authFetch(JOBS, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(json);
  },
  updateJob(id, body) {
    return authFetch(`${JOBS}/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(json);
  },
  deleteJob(id) {
    return authFetch(`${JOBS}/${id}`, { method: 'DELETE' });
  },
  getResume() {
    return authFetch('/api/resume').then(json);
  },
  saveResume(content) {
    return authFetch('/api/resume', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) }).then(json);
  },
  tailor(id, atsFeedback) {
    return runAsync(`tailor/${id}`, atsFeedback ? { atsFeedback } : {});
  },
  saveTailoredLatex(id, latex) {
    return authFetch(`/api/tailor/${id}/latex`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ latex }),
    }).then(json);
  },
  runAtsScore(id) {
    return runAsync(`ats-score/${id}`);
  },
  getPersistedAtsScore(id) {
    return authFetch(`/api/ats-score/${id}`).then(json);
  },
  runHackerRankScore(id) {
    return runAsync(`hackerrank-score/${id}`);
  },
  generatePdf(latex, filename) {
    return authFetch(`${BACKEND_URL}/api/pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ latex, filename }),
    });
  },
  sync() {
    return authFetch('/api/sync', { method: 'POST' }).then(json);
  },
  // Goes straight to the local apply-bot helper (server.js) running on your
  // own machine, NOT through the Netlify/Render proxy — Chrome has to open
  // where you can see and submit it, and Render has no display or browser.
  autoApply(id) {
    const base = import.meta.env.VITE_APPLY_BOT_URL || 'http://localhost:5055';
    return fetch(`${base}/apply/${id}`, { method: 'POST' }).then(json);
  },
  // Headless apply-bot deployed on Render (apply-bot-remote) — fills the
  // form there and pushes a screenshot to your phone via ntfy for you to
  // approve, instead of opening a browser window on this device. Reuses your
  // existing Job Tracker login as proof-of-you; the service forwards it back
  // to this same backend to check it's real, rather than needing its own login.
  remoteAutoApply(id) {
    const base = import.meta.env.VITE_APPLY_BOT_REMOTE_URL || 'https://apply-bot-remote.onrender.com';
    const token = getToken();
    return fetch(`${base}/apply/${id}`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }).then(json);
  },
};
