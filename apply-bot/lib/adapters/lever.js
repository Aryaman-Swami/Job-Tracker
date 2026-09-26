const { pause, waitForEnter } = require('../human');
const { fillFirst, uploadResumeGeneric, hasUnfilledRequiredFields } = require('../formfill');

function matches(host) {
  return /(^|\.)lever\.co$/i.test(host) || /jobs\.lever\.co$/i.test(host);
}

// Lever postings are also guest-application forms — same no-login-risk shape
// as Greenhouse, different field names.
async function run(page, ctx) {
  await pause(800, 1500);

  await fillFirst(page, ['input[name="name"]'], ctx.fullName);
  await fillFirst(page, ['input[name="email"]'], ctx.email);
  await fillFirst(page, ['input[name="phone"]'], ctx.phone);

  const uploaded = await uploadResumeGeneric(page, ctx.resumePath);
  if (!uploaded) {
    await waitForEnter('Could not find a resume upload field automatically — please attach the tailored resume yourself.');
  }

  if (await hasUnfilledRequiredFields(page)) {
    await waitForEnter('This application has required/custom questions the bot won\'t guess at. Fill them in, then continue.');
  }

  console.log('Lever form filled — please review and click "Submit Application" yourself.');
  return 'review';
}

// Used by the remote/headless flow after you approve the review screenshot.
async function submit(page) {
  const btn = page.locator('button[type="submit"]:has-text("Submit Application"), button[type="submit"]').first();
  if (!(await btn.isVisible({ timeout: 5000 }).catch(() => false))) return false;
  await btn.click();
  await pause(1000, 2000);
  return true;
}

module.exports = { name: 'lever', matches, run, submit, canRemoteSubmit: true };
