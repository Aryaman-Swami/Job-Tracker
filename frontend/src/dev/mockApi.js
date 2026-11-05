// Dev-only: swaps the real API for an in-memory one over the sample fixture, so the
// interface can be checked without the Spring Boot backend. Loaded only by main.jsx when
// the dev server is opened with ?fixture. Extra switches: &fail=jobs (list request fails),
// &empty (no jobs), &slow (long loading), &login (start signed out).
import { fixture, BASE_RESUME } from './fixture.js';

const flags = new URLSearchParams(location.search);
const wait = ms => new Promise(r => setTimeout(r, flags.has('slow') ? ms * 20 : ms));

let jobs = [...fixture.scraped, ...fixture.older, ...fixture.manual];
const olderIds = new Set(fixture.older.map(j => j.id));
let resume = BASE_RESUME;

function page(params) {
  let rows = jobs.filter(j => (params.before ? olderIds.has(j.id) : !olderIds.has(j.id)));
  if (params.source === 'manual') rows = rows.filter(j => j.source === 'manual');
  else rows = rows.filter(j => j.source !== 'manual');
  rows = params.status ? rows.filter(j => j.status === params.status) : rows.filter(j => j.status !== 'not_interested');
  if (params.needs_referral === 'true') rows = rows.filter(j => j.needs_referral);
  if (params.search) rows = rows.filter(j => j.company.toLowerCase().includes(params.search));
  rows = [...rows].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const hasMore = !params.before && params.source !== 'manual' && rows.length > 0;
  return { jobs: flags.has('empty') ? [] : rows, hasMore: flags.has('empty') ? false : hasMore, nextBefore: hasMore ? 'older' : null };
}

// A one-page PDF with a single line of text, built by hand so no library is needed.
function samplePdf(title) {
  const text = `Sample data: tailored resume preview for ${title}`.replace(/[()\\]/g, '');
  const stream = `BT /F1 14 Tf 72 760 Td (${text}) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = objs.map((o, i) => { const off = out.length; out += `${i + 1} 0 obj\n${o}\nendobj\n`; return off; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([out], { type: 'application/pdf' });
}

export function installFixture(api) {
  if (!flags.has('login')) {
    localStorage.setItem('jobtracker_token', 'fixture');
    localStorage.setItem('jobtracker_token_expires_at', String(Date.now() + 864e5));
  }
  const realFetch = window.fetch.bind(window);
  window.fetch = (url, opts) => {
    if (String(url).endsWith('/api/auth/login')) {
      const body = JSON.parse(opts.body || '{}');
      const ok = body.password === 'sample';
      return Promise.resolve(new Response(JSON.stringify(ok ? { ok, token: 'fixture', expiresInMs: 864e5 } : { ok, message: 'Wrong username or password.' }), { status: ok ? 200 : 401 }));
    }
    return realFetch(url, opts);
  };

  Object.assign(api, {
    async listJobsPage(params) {
      await wait(350);
      if (flags.get('fail') === 'jobs') throw new Error('Network error');
      return page(params);
    },
    async createJob(body) { await wait(200); const j = { ...body, id: Date.now(), source: 'manual', status: 'to_ask', created_at: new Date().toISOString() }; jobs = [j, ...jobs]; return j; },
    async updateJob(id, body) { await wait(150); jobs = jobs.map(j => (j.id === id ? { ...j, ...body } : j)); return jobs.find(j => j.id === id); },
    async deleteJob(id) { await wait(150); jobs = jobs.filter(j => j.id !== id); return new Response(null, { status: 204 }); },
    async getResume() { await wait(150); return { content: resume }; },
    async saveResume(content) { await wait(300); resume = content; return { ok: true }; },
    async tailor(id) {
      await wait(2500);
      const job = jobs.find(j => j.id === id);
      return { ok: true, latex: `${BASE_RESUME}\n% Tailored for ${job?.company}`, skillsMatch: ['Java', 'Spring Boot', 'PostgreSQL', 'Docker'], note: null };
    },
    async saveTailoredLatex() { await wait(200); return { ok: true }; },
    async runAtsScore(id) {
      await wait(1500);
      const job = jobs.find(j => j.id === id);
      const score = Math.min((job?.ats_score ?? 60) + 6, 100);
      return { ok: true, score, breakdown: { keywords: score - 6, skills: Math.min(score + 6, 100), experience: score - 2, title_alignment: Math.min(score + 3, 100) }, matched_keywords: ['Java', 'Spring Boot', 'PostgreSQL', 'REST APIs', 'Docker'], missing_keywords: ['Kafka'], suggestions: ['Name Kafka only if you have used it.'] };
    },
    async generatePdf(latex, filename) { await wait(600); return new Response(samplePdf(filename), { status: 200, headers: { 'Content-Type': 'application/pdf' } }); },
    async sync() { await wait(1200); return { ok: true }; },
  });
}
