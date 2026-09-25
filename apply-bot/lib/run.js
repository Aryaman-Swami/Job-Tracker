const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const { getJob, ensureTailoredLatex, renderPdf } = require('./backend');
const { handleAccountGate, startApplication, runWizard } = require('./workday');
const { pause } = require('./human');

function domainOf(url) {
  return new URL(url).hostname;
}

async function runApply(jobId, log = console.log) {
  const email = process.env.WORKDAY_EMAIL;
  const password = process.env.WORKDAY_PASSWORD;
  if (!email || !password) {
    throw new Error('Set WORKDAY_EMAIL and WORKDAY_PASSWORD in apply-bot/.env first.');
  }

  const job = await getJob(jobId);
  if (!job.job_url) {
    throw new Error(`Job ${jobId} has no job_url to apply to.`);
  }

  log(`Applying to: ${job.role} @ ${job.company}`);
  log(`URL: ${job.job_url}`);

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
  // manually. No stealth/fingerprint-spoofing plugins: if a tenant challenges
  // with a CAPTCHA, the script pauses and you solve it in this same window.
  const browser = await chromium.launch({ channel: 'chrome', headless: false });
  const context = await browser.newContext(hasSession ? { storageState: statePath } : {});
  const page = await context.newPage();

  try {
    await page.goto(job.job_url, { waitUntil: 'domcontentloaded' });
    await pause(1000, 2000);

    await startApplication(page);
    await handleAccountGate(page, email, password);
    await context.storageState({ path: statePath });

    const outcome = await runWizard(page, { resumePath });
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
