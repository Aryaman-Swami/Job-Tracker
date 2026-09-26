const fs = require('fs');
const path = require('path');
const { getBaseResumePdf } = require('./backend');

function pause(minMs, maxMs) {
  return new Promise((r) => setTimeout(r, minMs + Math.random() * (maxMs - minMs)));
}

async function waitForEnter(promptText) {
  console.log(`\n>>> ${promptText}\n>>> Press Enter in this terminal once done...`);
  await new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once('data', () => {
      process.stdin.pause();
      resolve();
    });
  });
}

// Never touches your Naukri password (same reasoning as apply-bot's naukri
// adapter) — this runs unattended via Task Scheduler most of the time, so if
// the session cookie ever expires, this will just hang here waiting for
// input nothing is watching. That's an accepted tradeoff over the
// alternative (storing/automating your Naukri login), not a bug — check
// scrape_run.log if a run seems stuck.
async function ensureLoggedIn(page) {
  const loginBtn = page.locator('#login_Layer, a:has-text("Login")').first();
  if (await loginBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await waitForEnter('Naukri needs you to log in. Please sign in manually in this window, then continue.');
  }
}

async function updateProfileResume(page) {
  const pdfBytes = await getBaseResumePdf();
  const tmpDir = path.join(__dirname, '..', 'tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  const resumePath = path.join(tmpDir, 'naukri_profile_resume.pdf');
  fs.writeFileSync(resumePath, pdfBytes);

  await page.goto('https://www.naukri.com/mnjuser/profile', { waitUntil: 'domcontentloaded' });
  await pause(1000, 1800);

  const fileInput = page.locator('input[type="file"]').first();
  const found = await fileInput.count();
  if (found > 0) {
    await fileInput.setInputFiles(resumePath);
    await pause(1500, 2500);
    console.log('Uploaded your base resume to your Naukri profile.');
  } else {
    console.warn('Could not find the resume upload field on your Naukri profile — skipping this run, profile resume unchanged.');
  }
}

module.exports = { ensureLoggedIn, updateProfileResume, pause };
