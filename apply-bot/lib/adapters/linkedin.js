const { pause, waitForEnter } = require('../human');
const { uploadResumeGeneric, hasUnfilledRequiredFields } = require('../formfill');

function matches(host) {
  return /(^|\.)linkedin\.com$/i.test(host);
}

async function ensureLoggedIn(page) {
  const loginForm = page.locator('#username, input[name="session_key"]').first();
  if (await loginForm.isVisible({ timeout: 3000 }).catch(() => false)) {
    // LinkedIn aggressively flags automated logins even for legitimate use,
    // so we never touch the password field here — you log in by hand once,
    // the cookie session gets reused on later runs.
    await waitForEnter('LinkedIn needs you to log in. Please sign in manually in this window, then continue.');
  }
}

async function clickEasyApply(page) {
  const btn = page.locator('button.jobs-apply-button, button[aria-label*="Easy Apply" i]').first();
  const visible = await btn.isVisible({ timeout: 8000 }).catch(() => false);
  if (!visible) {
    await waitForEnter('Could not find the "Easy Apply" button automatically — please click it yourself.');
    return;
  }
  await btn.click();
  await pause(800, 1500);
}

async function isReviewStep(page) {
  return page.locator('button[aria-label*="Submit application" i]').first().isVisible().catch(() => false);
}

async function runWizard(page, resumePath, maxSteps = 15) {
  let uploaded = false;
  for (let step = 0; step < maxSteps; step++) {
    await pause(600, 1200);

    if (await isReviewStep(page)) {
      console.log('\nReached LinkedIn\'s final review step. Stopping here on purpose —');
      console.log('please review and click "Submit application" yourself.');
      return 'review';
    }

    if (!uploaded) {
      uploaded = await uploadResumeGeneric(page, resumePath).catch(() => false);
    }

    if (await hasUnfilledRequiredFields(page)) {
      await waitForEnter('This step has required questions the bot won\'t guess at. Fill them in, then continue.');
    }

    const nextBtn = page.locator(
      'button[aria-label*="Continue to next step" i], button[aria-label*="Review your application" i], button[aria-label*="Next" i]'
    ).first();
    const canAdvance = await nextBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (!canAdvance) {
      await waitForEnter('No "Next"/"Review" button found — advance the form manually, then continue.');
      continue;
    }
    await nextBtn.click();
  }
  console.log('Hit the step safety limit without reaching Review — please finish this application manually.');
  return 'incomplete';
}

async function run(page, ctx) {
  await ensureLoggedIn(page);
  await clickEasyApply(page);
  return runWizard(page, ctx.resumePath);
}

module.exports = { name: 'linkedin', matches, run };
