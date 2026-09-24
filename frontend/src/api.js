import { getToken, logout } from './auth.js';

const JOBS = '/api/jobs';

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
    return authFetch(`/api/tailor/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(atsFeedback ? { atsFeedback } : {}),
    }).then(json);
  },
  saveTailoredLatex(id, latex) {
    return authFetch(`/api/tailor/${id}/latex`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ latex }),
    }).then(json);
  },
  runAtsScore(id) {
    return authFetch(`/api/ats-score/${id}`, { method: 'POST' }).then(json);
  },
  getPersistedAtsScore(id) {
    return authFetch(`/api/ats-score/${id}`).then(json);
  },
  runHackerRankScore(id) {
    return authFetch(`/api/hackerrank-score/${id}`, { method: 'POST' }).then(json);
  },
  generatePdf(latex, filename) {
    return authFetch('/api/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ latex, filename }),
    });
  },
  sync() {
    return authFetch('/api/sync', { method: 'POST' }).then(json);
  },
};
