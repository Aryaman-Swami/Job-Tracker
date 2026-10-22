const { pause, waitForEnter } = require('../human');
const { applyOnJobPage } = require('../naukri-apply');

function matches(host) {
  return /(^|\.)naukri\.com$/i.test(host);
}

async function ensureLoggedIn(page) {
  const loginBtn = page.locator('#login_Layer, a:has-text("Login")').first();
  if (await loginBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await waitForEnter('Naukri needs you to log in. Please sign in manually in this window, then continue.');
  }
}

async function updateProfileResume(page, resumePath) {
  const jobUrl = page.url();
  await page.goto('https://www.naukri.com/mnjuser/profile', { waitUntil: 'domcontentloaded' });
  await pause(1000, 1800);

  const fileInput = page.locator('input[type="file"]').first();
  const found = await fileInput.count();
  if (found > 0) {
    await fileInput.setInputFiles(resumePath);
    await pause(1500, 2500);
    console.log('Uploaded tailored resume to your Naukri profile.');
  } else {
    await waitForEnter('Could not find the resume upload field on your Naukri profile — please update it manually.');
  }

  await page.goto(jobUrl, { waitUntil: 'domcontentloaded' });
  await pause(1000, 1500);
}

// Updates the profile resume (Naukri applies with whatever is on the profile),
// then actually applies: handles the chatbot questionnaire, detects
// already-applied / "Apply on company site" (external) / expired jobs.
// Returns the outcome string from lib/naukri-apply.js.
async function run(page, ctx) {
  await ensureLoggedIn(page);
  await updateProfileResume(page, ctx.resumePath);
  let outcome = await applyOnJobPage(page, console.log);
  if (outcome === 'session_expired') {
    await waitForEnter('Naukri session expired. Log in in this window, then continue.');
    await page.reload({ waitUntil: 'domcontentloaded' });
    outcome = await applyOnJobPage(page, console.log);
  }
  if (outcome === 'needs_input') {
    console.log('The chatbot asked something with no configured answer — add a rule to apply-bot/naukri-answers.json or finish it by hand.');
  }
  return outcome;
}

module.exports = { name: 'naukri', matches, run };
