require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { passesFilters, parseExperience } = require('../naukri-scraper/lib/filters');
const { notifyNewJobs } = require('../naukri-scraper/lib/notify');
const store = require('./lib/apply-store');
const { recordApplication } = require('./lib/backend');

const SESSION = path.join(__dirname, 'sessions', 'instahyre.json');
const OPPS = 'https://www.instahyre.com/candidate/opportunities/?matching=true';
const SKILLS = ['Java', 'Spring Boot', 'Microservices', 'Node.js'];
const PAGES_PER_SKILL = 3; // 35 jobs per page
const DAILY_CAP = Number(process.env.INSTAHYRE_DAILY_CAP) || 30;
const MAX_EXP_MIN = 5; // skip roles asking for more than 5 years minimum
// Locations Instahyre lists as "Bangalore,Chennai,Mumbai"; Chennai/Kochi etc. are unwanted.
const BAD_CITY = /chennai|kochi|kerala|tamil\s*nadu/i;

const pause = (a, b) => new Promise((r) => setTimeout(r, a + Math.random() * (b - a)));

// Runs in the page so the saved login cookies are used. Matching = the
// "Recommended jobs" tab; job_search = the Search tab, per skill keyword.
async function fetchJson(page, url) {
  return page.evaluate(async (u) => {
    const r = await fetch(u, { headers: { Accept: 'application/json' } });
    return r.ok ? r.json() : null;
  }, url);
}

async function gatherJobs(page) {
  const byId = new Map();
  const add = (o, from) => {
    if (o && o.id && o.is_active !== false && !byId.has(o.id))
      byId.set(o.id, { id: o.id, company: o.employer?.company_name || 'Unknown', role: o.title || o.candidate_title || '', location: o.locations || '', keywords: (o.keywords || []).join(' '), job_url: o.public_url, from });
  };
  for (let off = 0; off < 150; off += 30) {
    const j = await fetchJson(page, `/api/v1/candidate_opportunities/candidate_matching?limit=30&offset=${off}&interest_facet=0`);
    if (!j || !j.objects?.length) break;
    j.objects.forEach((o) => add(o.job || o, 'recommended'));
    if (!j.meta?.next) break;
  }
  for (const skill of SKILLS) {
    for (let p = 0; p < PAGES_PER_SKILL; p++) {
      const j = await fetchJson(page, `/api/v1/job_search?company_size=0&job_type=0&status=0&skills=${encodeURIComponent(skill)}&limit=35&offset=${p * 35}`);
      if (!j || !j.objects?.length) break;
      j.objects.forEach((o) => add(o, `search:${skill}`));
      if (!j.meta?.next) break;
      await pause(500, 1200);
    }
  }
  return Array.from(byId.values());
}

function passes(job, experience = '') {
  const cities = job.location.split(/[,/]/).map((s) => s.trim()).filter(Boolean);
  const okCities = cities.filter((c) => !BAD_CITY.test(c));
  if (cities.length && !okCities.length) return false;
  const exp = parseExperience(experience);
  if (exp && exp.min > MAX_EXP_MIN) return false;
  return passesFilters({ title: job.role, company: job.company, location: okCities.join(', '), experience, description: job.keywords });
}

// Open the public job page (shows the apply modal for a logged-in user).
async function applyToJob(page, job) {
  await page.goto(job.job_url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await pause(2500, 4000);
  if (/\/login/.test(page.url())) return { outcome: 'session_expired' };
  const text = await page.evaluate(() => document.body.innerText).catch(() => '');
  const expMatch = /(\d+\s*-\s*\d+\s*Years?)/i.exec(text);
  const experience = expMatch ? expMatch[1].replace(/years?/i, 'yrs') : '';
  if (!passes(job, experience)) return { outcome: 'skipped_filter', experience };
  if (/already applied|you have applied|application sent/i.test(text) && !(await page.locator('button:has-text("Apply now")').first().isVisible().catch(() => false))) return { outcome: 'already_applied' };

  // The visible <a> overlays the <button> and intercepts the click; it only
  // renders when the job isn't applied yet.
  const btn = page.locator('a.text-center:has-text("Apply now"), button:text-is("Apply")').first();
  if (!(await btn.isVisible({ timeout: 4000 }).catch(() => false))) return { outcome: 'error', detail: 'no apply button' };
  await btn.scrollIntoViewIfNeeded().catch(() => {});
  await pause(500, 1100);
  await btn.click();
  await pause(3000, 4500);

  const after = await page.evaluate(() => document.body.innerText).catch(() => '');
  if (/successfully applied|application (has been )?(sent|submitted)|applied successfully|you('| ha)ve applied|thank/i.test(after)) return { outcome: 'applied' };
  if (!(await btn.isVisible({ timeout: 800 }).catch(() => false)) && !/apply now/i.test(after)) return { outcome: 'applied' };
  const dialog = await page.evaluate(() => (document.querySelector('.modal.in, .modal.show, [role=dialog]')?.innerText || '').slice(0, 400)).catch(() => '');
  return { outcome: 'needs_input', detail: dialog || after.slice(0, 300) };
}

async function main() {
  console.log(`=== Instahyre run started ${new Date().toISOString()} ===`);
  if (!fs.existsSync(SESSION)) throw new Error('No session. Run `node login.js` first.');
  const limit = Number(process.env.INSTAHYRE_LIMIT) || Infinity; // for test runs
  const browser = await chromium.launch({ channel: 'chrome', headless: false });
  const context = await browser.newContext({ storageState: SESSION });
  const page = await context.newPage();
  try {
    await page.goto(OPPS, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await pause(3000, 4500);
    if (/\/login/.test(page.url())) {
      console.error('Instahyre session expired - run `node login.js`.');
      process.exitCode = 1;
      return;
    }

    const all = await gatherJobs(page);
    const ledger = store.load();
    const candidates = all.filter((j) => passes(j) && store.needsAttempt(ledger, j.job_url));
    console.log(`gathered=${all.length}, passing_filters_and_unapplied=${candidates.length} (cap ${DAILY_CAP}/day)`);

    const summary = {};
    const applied = [];
    let n = 0;
    for (const job of candidates) {
      if (n >= limit || store.appliedToday(ledger) >= DAILY_CAP) break;
      n++;
      let r;
      try {
        r = await applyToJob(page, job);
      } catch (e) {
        r = { outcome: 'error', detail: e.message };
      }
      const { outcome } = r;
      console.log(`[apply] ${outcome.padEnd(15)} ${job.company} - ${job.role} (${job.location})${r.detail ? ' :: ' + String(r.detail).replace(/\s+/g, ' ').slice(0, 200) : ''}`);
      summary[outcome] = (summary[outcome] || 0) + 1;
      store.record(ledger, job.job_url, { company: job.company, role: job.role }, outcome);
      store.save(ledger);
      if (outcome === 'applied') applied.push(job);
      if (outcome !== 'skipped_filter') await recordApplication({ ...job, ref: String(job.id) }, outcome).catch((e) => console.warn(`backend write-back failed: ${e.message}`));
      if (outcome === 'session_expired') break;
      await pause(15000, 35000);
    }
    console.log('summary:', JSON.stringify(summary));
    await context.storageState({ path: SESSION }).catch(() => {});
    if (applied.length) await notifyNewJobs(applied.map((j) => ({ ...j, role: `${j.role} (applied)` })));
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error('Instahyre run failed:', e);
  process.exitCode = 1;
});
