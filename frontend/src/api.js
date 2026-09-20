const JOBS = '/api/jobs';

async function json(res) {
  return res.json();
}

export const api = {
  listJobs(params) {
    return fetch(`${JOBS}?${new URLSearchParams(params)}`).then(json);
  },
  createJob(body) {
    return fetch(JOBS, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(json);
  },
  updateJob(id, body) {
    return fetch(`${JOBS}/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(json);
  },
  deleteJob(id) {
    return fetch(`${JOBS}/${id}`, { method: 'DELETE' });
  },
  getResume() {
    return fetch('/api/resume').then(json);
  },
  saveResume(content) {
    return fetch('/api/resume', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) }).then(json);
  },
  tailor(id, atsFeedback) {
    return fetch(`/api/tailor/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(atsFeedback ? { atsFeedback } : {}),
    }).then(json);
  },
  saveTailoredLatex(id, latex) {
    return fetch(`/api/tailor/${id}/latex`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ latex }),
    }).then(json);
  },
  runAtsScore(id) {
    return fetch(`/api/ats-score/${id}`, { method: 'POST' }).then(json);
  },
  getPersistedAtsScore(id) {
    return fetch(`/api/ats-score/${id}`).then(json);
  },
  runHackerRankScore(id) {
    return fetch(`/api/hackerrank-score/${id}`, { method: 'POST' }).then(json);
  },
  generatePdf(latex, filename) {
    return fetch('/api/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ latex, filename }),
    });
  },
  sync() {
    return fetch('/api/sync', { method: 'POST' }).then(json);
  },
};
