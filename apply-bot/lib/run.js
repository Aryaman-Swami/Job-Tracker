const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const { getJob, ensureTailoredLatex, renderPdf } = require('./backend');
const { pause } = require('./human');
const { findAdapter } = require('./adapters');
const sessions = require('./sessions');
const { notifyText, notifyWithScreenshot } = require('./notify');

function domainOf(url) {
  return new URL(url).hostname;
}

function splitName(fullName) {
  if (!fullName) return { firstName: undefined, lastName: undefined };
  const parts = fullName.trim().split(/\s+/);
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') || undefined };
}

async function prepare(jobId, log) {
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

  const { firstName, lastName } = splitName(process.env.CANDIDATE_FULL_NAME);
  const ctx = {
    resumePath,
    // Only Workday gets real credentials — the other adapters either need no
    // account (Greenhouse/Lever) or pause for you to log in by hand (Naukri/
    // LinkedIn/Indeed/Wellfound), see each adapter file for why.
    email: adapter.name === 'workday' ? process.env.WORKDAY_EMAIL : process.env.CANDIDATE_EMAIL,
    password: process.env.WORKDAY_PASSWORD,
    fullName: process.env.CANDIDATE_FULL_NAME,
    firstName,
    lastName,
    phone: process.env.CANDIDATE_PHONE,
  };

  return { job, adapter, resumePath, ctx, rootDir };
}

async function runApply(jobId, log = console.log) {
  const { job, adapter, ctx, rootDir } = await prepare(jobId, log);

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
  ctx.onSessionReady = () => context.storageState({ path: statePath });

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

// Headless flow for the Render-hosted service: fills the form same as
// runApply, but there's no screen for you to review on, so instead of
// leaving a visible browser open, it screenshots the review step and pushes
// it to your phone via ntfy. If the site has a known, safe submit button
// (Workday/LinkedIn/Indeed/Greenhouse/Lever), the browser session is kept
// alive so a later approved submitRemote() call can finish it. Sites with no
// safe single button (Naukri/Wellfound/generic) get closed immediately —
// there's nothing this flow can safely finish unattended, so you're told to
// go do it yourself on the actual site.
async function runApplyRemote(jobId, log, reviewUrl) {
  process.env.APPLY_BOT_HEADLESS = '1';
  const { job, adapter, ctx } = await prepare(jobId, log);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  let outcome;
  try {
    await page.goto(job.job_url, { waitUntil: 'domcontentloaded' });
    await pause(1000, 2000);
    outcome = await adapter.run(page, ctx);
  } catch (err) {
    log(`Apply-bot hit an error: ${err.message}`);
    await browser.close().catch(() => {});
    await notifyText(
      `${job.company}: apply failed`,
      `${job.role} — ${err.message}. Nothing was submitted.`,
      job.job_url
    );
    throw err;
  }

  const screenshot = await page.screenshot({ fullPage: true }).catch(() => null);

  if (adapter.canRemoteSubmit && outcome === 'review') {
    sessions.set(jobId, { browser, context, page, adapter, job });
    await notifyWithScreenshot(
      `${job.company}: ready to review`,
      `${job.role} — filled and waiting at the review step. Tap to check it and confirm submit.`,
      screenshot,
      reviewUrl
    );
    log(`Session kept alive for job ${jobId}, awaiting remote approval.`);
    return 'awaiting_review';
  }

  await browser.close().catch(() => {});
  await notifyText(
    `${job.company}: needs manual finish`,
    `${job.role} — this site has no safe one-button submit to do remotely. ` +
      `Resume was updated where possible; please open it and finish this one yourself.`,
    job.job_url
  );
  return 'manual_required';
}

async function submitRemote(jobId) {
  const session = sessions.get(jobId);
  if (!session) throw new Error('No pending session for this job (it may have expired after 20 minutes).');

  const { page, adapter, job } = session;
  try {
    const ok = await adapter.submit(page);
    await notifyText(
      ok ? `${job.company}: submitted` : `${job.company}: submit failed`,
      ok
        ? `${job.role} — application submitted.`
        : `${job.role} — couldn't find the submit button anymore. Please check ${job.job_url} yourself.`,
      job.job_url
    );
    return ok;
  } finally {
    sessions.clear(jobId); // also closes the browser
  }
}

function rejectRemote(jobId) {
  const session = sessions.get(jobId);
  sessions.clear(jobId);
  return !!session;
}

module.exports = { runApply, runApplyRemote, submitRemote, rejectRemote };
