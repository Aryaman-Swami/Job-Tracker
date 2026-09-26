const { pause, typeLikeHuman, waitForEnter } = require('../human');

// Workday's own frontend reuses the same `data-automation-id` values across
// almost every company's tenant (they're all built from the same Workday
// product), so one set of selectors covers most postings. Still best-effort —
// tenants customize field sets, so we pause for a human whenever we're not
// confident rather than guessing.

const SEL = {
  applyManually: '[data-automation-id="applyManually"]',
  autofillWithResume: '[data-automation-id="autofillWithResume"]',
  useMyLastApplication: '[data-automation-id="useMyLastApplication"]',
  email: '[data-automation-id="email"]',
  password: '[data-automation-id="password"]',
  verifyPassword: '[data-automation-id="verifyPassword"]',
  createAccountToggle: '[data-automation-id="createAccountCheckbox"]',
  createAccountSubmit: '[data-automation-id="createAccountSubmitButton"]',
  signInSubmit: '[data-automation-id="signInSubmitButton"]',
  signInLink: '[data-automation-id="signInLink"]',
  fileInput: 'input[type="file"]',
  nextButton: '[data-automation-id="pageFooterNextButton"]',
  submitButton: '[data-automation-id="pageFooterSubmitButton"]',
  legalNameSection: '[data-automation-id="legalNameSection"]',
};

async function findFirst(page, selectors, timeout = 4000) {
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    try {
      await loc.waitFor({ state: 'visible', timeout });
      return loc;
    } catch {
      // try next selector
    }
  }
  return null;
}

async function handleAccountGate(page, email, password) {
  const emailField = await findFirst(page, [SEL.email], 6000);
  if (!emailField) return; // no login gate on this page

  console.log('Workday account gate detected — attempting login, falling back to sign-up.');
  await typeLikeHuman(emailField, email);
  await pause();

  const pwField = page.locator(SEL.password).first();
  await typeLikeHuman(pwField, password);
  await pause();

  const signInBtn = page.locator(SEL.signInSubmit).first();
  if (await signInBtn.isVisible().catch(() => false)) {
    await signInBtn.click();
    await pause(800, 1500);
    const stillOnGate = await page.locator(SEL.email).first().isVisible().catch(() => false);
    if (!stillOnGate) {
      console.log('Logged in with existing account.');
      return;
    }
    console.log('Login did not succeed — trying account creation instead.');
  }

  const verifyField = page.locator(SEL.verifyPassword).first();
  if (await verifyField.isVisible().catch(() => false)) {
    await typeLikeHuman(verifyField, password);
  }
  const toggle = page.locator(SEL.createAccountToggle).first();
  if (await toggle.isVisible().catch(() => false)) {
    await toggle.check().catch(() => {});
  }
  const createBtn = page.locator(SEL.createAccountSubmit).first();
  if (await createBtn.isVisible().catch(() => false)) {
    await createBtn.click();
    await pause(800, 1500);
    console.log('Submitted account creation.');
  } else {
    await waitForEnter('Could not find a Create Account button — please sign in or sign up manually.');
  }
}

async function startApplication(page) {
  const applyBtn = await findFirst(page, [SEL.applyManually, SEL.autofillWithResume, SEL.useMyLastApplication], 8000);
  if (!applyBtn) {
    await waitForEnter('Could not find an Apply button automatically — please click "Apply" on the job page.');
    return;
  }
  // Prefer manual apply so the resume we upload drives every field, rather
  // than Workday's resume-parse autofill silently overwriting fields with its
  // own (often wrong) parse.
  const manual = page.locator(SEL.applyManually).first();
  if (await manual.isVisible().catch(() => false)) {
    await manual.click();
  } else {
    await applyBtn.click();
  }
  await pause(800, 1500);
}

async function uploadResume(page, resumePath) {
  const fileInput = page.locator(SEL.fileInput).first();
  const visible = await fileInput.isVisible({ timeout: 3000 }).catch(() => false);
  if (!visible) {
    // Some steps hide the native input behind a styled dropzone; try anyway.
    const count = await page.locator(SEL.fileInput).count();
    if (count === 0) return false;
  }
  await fileInput.setInputFiles(resumePath);
  console.log(`Uploaded tailored resume: ${resumePath}`);
  await pause(1200, 2000);
  return true;
}

async function isReviewStep(page) {
  const submitVisible = await page.locator(SEL.submitButton).first().isVisible().catch(() => false);
  if (submitVisible) return true;
  const heading = await page.locator('h1, h2').filter({ hasText: /review/i }).first().isVisible().catch(() => false);
  return heading;
}

async function hasUnfilledRequiredFields(page) {
  // Workday marks required fields with aria-required or a red asterisk wrapper;
  // flag empty required text/select inputs so a human can fill anything the
  // resume upload didn't cover (custom screening questions, etc).
  const requiredInputs = page.locator('[aria-required="true"]');
  const total = await requiredInputs.count();
  for (let i = 0; i < total; i++) {
    const el = requiredInputs.nth(i);
    const tag = await el.evaluate((n) => n.tagName.toLowerCase()).catch(() => '');
    if (tag === 'input' || tag === 'textarea') {
      const value = await el.inputValue().catch(() => '');
      if (!value || !value.trim()) return true;
    }
  }
  return false;
}

async function runWizard(page, { resumePath, maxSteps = 25 }) {
  let uploaded = false;
  for (let step = 0; step < maxSteps; step++) {
    await pause(600, 1200);

    if (await isReviewStep(page)) {
      console.log('\nReached the Review step. Stopping here on purpose —');
      console.log('please review every section in the open browser window and click Submit yourself.');
      return 'review';
    }

    if (!uploaded) {
      uploaded = await uploadResume(page, resumePath).catch(() => false);
    }

    if (await hasUnfilledRequiredFields(page)) {
      await waitForEnter('This page has required fields the bot won\'t guess at (custom questions, etc). Fill them in the browser, then continue.');
    }

    const nextBtn = page.locator(SEL.nextButton).first();
    const canAdvance = await nextBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (!canAdvance) {
      await waitForEnter('No "Next" button found — advance the form manually in the browser, then continue.');
      continue;
    }
    await nextBtn.click();
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  }
  console.log('Hit the step safety limit without reaching Review — please finish this application manually.');
  return 'incomplete';
}

function matches(host) {
  return /myworkdayjobs\.com$/i.test(host) || /workday/i.test(host);
}

// Enterprise ATS, per-company throwaway candidate account — safe to automate
// the login/sign-up step here (unlike the consumer-platform adapters).
async function run(page, ctx) {
  await startApplication(page);
  await handleAccountGate(page, ctx.email, ctx.password);
  if (ctx.onSessionReady) await ctx.onSessionReady();
  return runWizard(page, { resumePath: ctx.resumePath });
}

module.exports = { name: 'workday', matches, run, handleAccountGate, startApplication, runWizard };
