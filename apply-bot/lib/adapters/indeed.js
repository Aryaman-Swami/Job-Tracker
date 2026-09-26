const { pause, waitForEnter } = require('../human');
const { uploadResumeGeneric, hasUnfilledRequiredFields } = require('../formfill');

function matches(host) {
  return /(^|\.)indeed\.com$/i.test(host);
}

async function ensureLoggedIn(page) {
  const loginForm = page.locator('input[name="__email"], input#login-email-input').first();
  if (await loginForm.isVisible({ timeout: 3000 }).catch(() => false)) {
    await waitForEnter('Indeed needs you to log in. Please sign in manually in this window, then continue.');
  }
}

async function clickApply(page) {
  const btn = page.locator('button:has-text("Apply now"), #indeedApplyButton').first();
  const visible = await btn.isVisible({ timeout: 8000 }).catch(() => false);
  if (!visible) {
    await waitForEnter('Could not find the "Apply now" button automatically — please click it yourself.');
    return;
  }
  await btn.click();
  await pause(1000, 1800);
}

async function isReviewStep(page) {
  return page.locator('button:has-text("Submit your application"), button[aria-label*="Submit your application" i]')
    .first().isVisible().catch(() => false);
}

async function runWizard(page, resumePath, maxSteps = 15) {
  let uploaded = false;
  for (let step = 0; step < maxSteps; step++) {
    await pause(600, 1200);

    if (await isReviewStep(page)) {
      console.log('\nReached Indeed\'s final review step. Stopping here on purpose —');
      console.log('please review and click "Submit your application" yourself.');
      return 'review';
    }

    if (!uploaded) {
      uploaded = await uploadResumeGeneric(page, resumePath).catch(() => false);
    }

    if (await hasUnfilledRequiredFields(page)) {
      await waitForEnter('This step has required questions the bot won\'t guess at. Fill them in, then continue.');
    }

    const nextBtn = page.locator('button:has-text("Continue"), button[aria-label*="Continue" i]').first();
    const canAdvance = await nextBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (!canAdvance) {
      await waitForEnter('No "Continue" button found — advance the form manually, then continue.');
      continue;
    }
    await nextBtn.click();
  }
  console.log('Hit the step safety limit without reaching Review — please finish this application manually.');
  return 'incomplete';
}

async function run(page, ctx) {
  await ensureLoggedIn(page);
  await clickApply(page);
  return runWizard(page, ctx.resumePath);
}

module.exports = { name: 'indeed', matches, run };
