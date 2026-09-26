const { pause, waitForEnter } = require('../human');

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

// Naukri's "Apply" is almost always a single, immediate submit — there is no
// intermediate review screen to safely stop at like Workday/LinkedIn/Indeed.
// So the bot never touches that button: it only makes sure your tailored
// resume is attached to your profile, then hands off entirely.
async function run(page, ctx) {
  await ensureLoggedIn(page);
  await updateProfileResume(page, ctx.resumePath);
  console.log('\nYour profile resume is updated. Naukri\'s Apply button submits immediately on click,');
  console.log('so please open the job and click Apply yourself when ready.');
  return 'handoff';
}

module.exports = { name: 'naukri', matches, run };
