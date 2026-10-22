// Auto-apply for every job the Naukri search returned, when the local
// apply-bot is running. Reuses the page-level apply logic from apply-bot.
const path = require('path');
const { applyToUrl, isLoggedIn } = require('../../apply-bot/lib/naukri-apply');
const store = require('./apply-store');
const { recordApplication } = require('./backend');
const { pause } = require('./naukri-account');

const BOT_PORT = process.env.APPLY_BOT_PORT || 5055;
const DAILY_CAP = Number(process.env.NAUKRI_DAILY_CAP) || 40;

// NAUKRI_AUTO_APPLY: "0" force off, "1" force on, unset = on iff the local
// apply-bot answers /health.
async function botActive() {
  const flag = process.env.NAUKRI_AUTO_APPLY;
  if (flag === '0') return false;
  if (flag === '1') return true;
  try {
    const res = await fetch(`http://127.0.0.1:${BOT_PORT}/health`, { signal: AbortSignal.timeout(2000) });
    const j = await res.json();
    return !!(res.ok && j.ok && j.active !== false);
  } catch {
    return false;
  }
}

async function notify(title, body) {
  try {
    const fs = require('fs');
    const t = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'scraper', 'notify_config.json'), 'utf8')).ntfy_topic;
    if (t) await fetch(`https://ntfy.sh/${t}`, { method: 'POST', body, headers: { Title: title } });
  } catch {}
}

// jobs: [{company, role, job_url, location}]. page: logged-in Playwright page.
async function applyAll(page, jobs, context) {
  const ledger = store.load();
  const queue = jobs.filter((j) => store.needsAttempt(ledger, j.job_url));
  const summary = {};
  console.log(`[auto-apply] ${jobs.length} candidate(s), ${queue.length} need an attempt (cap ${DAILY_CAP}/day)`);
  if (!queue.length) return summary;

  if (!(await isLoggedIn(page))) {
    console.warn('[auto-apply] Naukri session expired - log in once (run `npm run scrape` interactively). Skipping apply this run.');
    await notify('Naukri auto-apply paused', 'Session expired - log in to Naukri in the scraper window once.');
    return { session_expired: queue.length };
  }

  for (const job of queue) {
    if (store.appliedToday(ledger) >= DAILY_CAP) {
      console.log('[auto-apply] daily cap reached, remaining jobs wait for the next run.');
      break;
    }
    const jobPage = await context.newPage();
    let outcome;
    try {
      outcome = await applyToUrl(jobPage, job.job_url, (m) => console.log(`[auto-apply] ${m}`));
    } finally {
      await jobPage.close().catch(() => {});
    }
    console.log(`[auto-apply] ${outcome.padEnd(15)} ${job.company} - ${job.role}`);
    summary[outcome] = (summary[outcome] || 0) + 1;
    store.record(ledger, job.job_url, { company: job.company, role: job.role }, outcome);
    store.save(ledger);
    await recordApplication(job, outcome).catch((e) => console.warn(`[auto-apply] backend write-back failed: ${e.message}`));

    if (outcome === 'session_expired') {
      await notify('Naukri auto-apply paused', 'Session expired mid-run - log in again.');
      break;
    }
    if (outcome === 'limit_reached') break;
    await pause(20000, 45000); // human-like gap between applications
  }
  return summary;
}

module.exports = { botActive, applyAll };
