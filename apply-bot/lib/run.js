const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const { getJob, ensureTailoredLatex, renderPdf } = require('./backend');
const { pause } = require('./human');
const { findAdapter } = require('./adapters');

function domainOf(url) {
  return new URL(url).hostname;
}

function splitName(fullName) {
  if (!fullName) return { firstName: undefined, lastName: undefined };
  const parts = fullName.trim().split(/\s+/);
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') || undefined };
}

async function runApply(jobId, log = console.log) {
  const job = await getJob(jobId);
  if (!job.job_url) {
    throw new Error(`Job ${jobId} has no job_url to apply to.`);
  }

  const adapter = findAdapter(job.job_url);
  log(`Applying to: ${job.role} @ ${job.company}`);
  log(`URL: ${job.job_url}`);
  log(`Using adapter: ${adapter.name}`);

  const latex = await ensureTailoredLatex(jobId);
  const pdfBytes = await renderPdf(latex, `${job.company}_${job.role}`.replace(/[^a-z0-9]+/gi, '_'));

  const rootDir = path.join(__dirname, '..');
  const tmpDir = path.join(rootDir, 'tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  const resumePath = path.join(tmpDir, `resume_${jobId}.pdf`);
  fs.writeFileSync(resumePath, pdfBytes);
  log(`Tailored resume saved to ${resumePath}`);

  const sessionsDir = path.join(rootDir, 'sessions');
  fs.mkdirSync(sessionsDir, { recursive: true });
  const domain = domainOf(job.job_url);
  const statePath = path.join(sessionsDir, `${domain}.json`);
  const hasSession = fs.existsSync(statePath);

  // Headed, real Chrome — not headless, not the bundled Chromium — because a
  // visible, real-browser session is indistinguishable from you browsing
  // manually. No stealth/fingerprint-spoofing plugins: if a site challenges
  // with a CAPTCHA, the script pauses and you solve it in this same window.
  const browser = await chromium.launch({ channel: 'chrome', headless: false });
  const context = await browser.newContext(hasSession ? { storageState: statePath } : {});
  const page = await context.newPage();

  const { firstName, lastName } = splitName(process.env.CANDIDATE_FULL_NAME);
  const ctx = {
    resumePath,
    // Only Workday gets real credentials — the other adapters either need no
    // account (Greenhouse/Lever) or pause for you to log in by hand (Naukri/
    // LinkedIn/Indeed/Wellfound), see each adapter file for why.
    email: process.env.WORKDAY_EMAIL,
    password: process.env.WORKDAY_PASSWORD,
    fullName: process.env.CANDIDATE_FULL_NAME,
    firstName,
    lastName,
    phone: process.env.CANDIDATE_PHONE,
    onSessionReady: () => context.storageState({ path: statePath }),
  };
  // Non-Workday adapters use your own contact email, not the Workday login.
  if (adapter.name !== 'workday') ctx.email = process.env.CANDIDATE_EMAIL;

  try {
    await page.goto(job.job_url, { waitUntil: 'domcontentloaded' });
    await pause(1000, 2000);

    const outcome = await adapter.run(page, ctx);
    await context.storageState({ path: statePath }).catch(() => {});
    log(`Done — outcome: ${outcome}. Browser stays open for you to finish/submit.`);
    return outcome;
  } catch (err) {
    log(`Apply-bot hit an error: ${err.message}`);
    log('Browser stays open so you can pick up from here manually.');
    throw err;
  }
  // Deliberately not closing the browser/context — final review and the
  // Submit click are always a manual, human action.
}

module.exports = { runApply };
