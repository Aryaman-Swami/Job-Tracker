// Orchestrator. Pulls to_ask jobs from the Job Tracker backend, opens each in a
// background tab, hands the content script the profile + tailored resume, and
// writes the outcome back to the tracker. State lives in chrome.storage (MV3
// service workers get killed when idle) and pacing uses chrome.alarms.

const SUPPORTED = /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com)$/i;
const JOB_TIMEOUT_MIN = 6;
const MARK = '[auto-apply]';

const DEFAULTS = {
  backendUrl: 'https://job-tracker-g8bx.onrender.com',
  username: 'admin',
  password: '',
  firstName: '', lastName: '', email: '', phone: '',
  linkedin: '', github: '', website: '', location: '', currentCompany: '',
  workdayEmail: '', workdayPassword: '',
  answers: '[]',           // [{"match":"sponsor","answer":"No"}, ...]
  dailyCap: 15,
  minAts: 0,
  autoSubmit: true,
};

const get = (k) => chrome.storage.local.get(k).then((r) => r);
async function settings() {
  const { settings: s } = await get('settings');
  return { ...DEFAULTS, ...(s || {}) };
}
async function state() {
  const { st } = await get('st');
  return { running: false, current: null, skip: [], day: '', count: 0, ...(st || {}) };
}
const saveState = (st) => chrome.storage.local.set({ st });

async function log(msg) {
  const { logs = [] } = await get('logs');
  logs.push(`${new Date().toLocaleTimeString()}  ${msg}`);
  await chrome.storage.local.set({ logs: logs.slice(-60) });
}

// ---------- backend ----------
let token = null;
async function login(s) {
  const res = await fetch(`${s.backendUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: s.username, password: s.password }),
  });
  if (!res.ok) throw new Error(`login failed (${res.status})`);
  token = (await res.json()).token;
}
async function api(path, opts = {}, retry = true) {
  const s = await settings();
  if (!token) await login(s);
  const res = await fetch(`${s.backendUrl}${path}`, {
    ...opts,
    headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` },
  });
  if (res.status === 401 && retry) { token = null; return api(path, opts, false); }
  return res;
}

async function fetchQueue() {
  const s = await settings();
  const st = await state();
  const res = await api('/api/jobs?status=to_ask');
  if (!res.ok) throw new Error(`jobs fetch failed (${res.status})`);
  const jobs = await res.json();
  return jobs
    .filter((j) => {
      if (!j.job_url || j.needs_referral) return false;
      if ((j.notes || '').includes(MARK)) return false;           // already tried
      if (st.skip.includes(j.id)) return false;
      if (s.minAts && j.ats_score != null && j.ats_score < s.minAts) return false;
      try { return SUPPORTED.test(new URL(j.job_url).hostname); } catch { return false; }
    })
    .sort((a, b) => (b.ats_score ?? -1) - (a.ats_score ?? -1));
}

async function resumeBase64(job) {
  let latex = job.tailored_resume_latex;
  if (!latex || !latex.trim()) {
    await log(`Tailoring resume for ${job.company}…`);
    const r = await api(`/api/tailor/${job.id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.ok) throw new Error(`tailor failed: ${d.error || r.status}`);
    latex = d.latex;
  }
  const filename = `${job.company}_${job.role}`.replace(/[^a-z0-9]+/gi, '_');
  const pdf = await api('/api/pdf', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ latex, filename }),
  });
  if (!pdf.ok) throw new Error(`pdf failed (${pdf.status})`);
  const bytes = new Uint8Array(await pdf.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { b64: btoa(bin), name: `${filename}.pdf` };
}

async function writeBack(job, fields) {
  const notes = [job.notes, fields.note && `${MARK} ${new Date().toISOString().slice(0, 10)} ${fields.note}`]
    .filter(Boolean).join('\n');
  const body = { notes };
  if (fields.status) body.status = fields.status;
  await api(`/api/jobs/${job.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).catch((e) => log(`write-back failed: ${e.message}`));
}

// ---------- queue loop ----------
async function processNext() {
  let st = await state();
  if (!st.running || st.current) return;
  const s = await settings();
  const today = new Date().toDateString();
  if (st.day !== today) { st.day = today; st.count = 0; }
  if (st.count >= s.dailyCap) {
    st.running = false; await saveState(st);
    return log(`Daily cap (${s.dailyCap}) reached — stopped.`);
  }

  let queue;
  try { queue = await fetchQueue(); }
  catch (e) { st.running = false; await saveState(st); return log(`Stopped: ${e.message}`); }
  if (!queue.length) {
    st.running = false; await saveState(st);
    return log('Queue empty — done.');
  }

  const job = queue[0];
  try {
    await log(`Preparing ${job.role} @ ${job.company}`);
    const resume = await resumeBase64(job);
    await chrome.storage.session.set({ [`resume_${job.id}`]: resume });
    const tab = await chrome.tabs.create({ url: job.job_url, active: false });
    st.current = { job, tabId: tab.id, startedAt: Date.now() };
    await saveState(st);
    chrome.alarms.create('job-timeout', { delayInMinutes: JOB_TIMEOUT_MIN });
  } catch (e) {
    await log(`Skipped ${job.company}: ${e.message}`);
    st.skip.push(job.id); await saveState(st);
    chrome.alarms.create('next', { delayInMinutes: 0.5 });
  }
}

async function finish(result, timedOut = false) {
  const st = await state();
  if (!st.current) return;
  const { job, tabId } = st.current;
  chrome.alarms.clear('job-timeout');
  st.current = null;

  if (result.outcome === 'applied') {
    st.count += 1;
    await writeBack(job, { status: 'applied', note: `submitted via extension (${result.detail || ''})` });
    await log(`✔ Applied: ${job.role} @ ${job.company}`);
    chrome.tabs.remove(tabId).catch(() => {});
  } else {
    // needs_input / manual / error — never change status, leave the tab open for a human.
    const why = timedOut ? 'timed out' : `${result.outcome}: ${result.detail || ''}`;
    await writeBack(job, { note: `not submitted — ${why}` });
    await log(`✖ ${job.company}: ${why}`);
    st.skip.push(job.id);
    chrome.tabs.update(tabId, { active: false }).catch(() => {});
  }
  await saveState(st);
  chrome.storage.session.remove(`resume_${job.id}`);
  chrome.alarms.create('next', { delayInMinutes: 0.5 + Math.random() }); // 30–90s between applications
}

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'next') processNext();
  if (a.name === 'job-timeout') finish({ outcome: 'error', detail: 'timeout' }, true);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const st = await state();
  if (st.current?.tabId === tabId) finish({ outcome: 'error', detail: 'tab closed before finishing' });
});

// ---------- messages ----------
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    if (msg.type === 'getTask') {
      const st = await state();
      if (!st.running || !st.current || st.current.tabId !== sender.tab?.id) return reply(null);
      const s = await settings();
      const key = `resume_${st.current.job.id}`;
      const resume = (await chrome.storage.session.get(key))[key];
      return reply({ job: st.current.job, settings: s, resume });
    }
    if (msg.type === 'result') {
      const st = await state();
      if (st.current?.tabId === sender.tab?.id) await finish(msg.result);
      return reply({ ok: true });
    }
    if (msg.type === 'start') {
      const st = await state();
      st.running = true; st.skip = []; await saveState(st);
      await log('Started.');
      processNext();
      return reply({ ok: true });
    }
    if (msg.type === 'stop') {
      const st = await state();
      st.running = false; await saveState(st);
      chrome.alarms.clear('next');
      await log('Stopped (current tab left as-is).');
      return reply({ ok: true });
    }
    if (msg.type === 'queue') {
      try { return reply({ ok: true, jobs: (await fetchQueue()).map((j) => ({ id: j.id, role: j.role, company: j.company })) }); }
      catch (e) { return reply({ ok: false, error: e.message }); }
    }
    if (msg.type === 'resetToken') { token = null; return reply({ ok: true }); }
  })();
  return true; // async reply
});
