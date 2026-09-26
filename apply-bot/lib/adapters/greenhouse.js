const { pause, waitForEnter } = require('../human');
const { fillFirst, uploadResumeGeneric, hasUnfilledRequiredFields } = require('../formfill');

function matches(host) {
  return /(^|\.)greenhouse\.io$/i.test(host) || /(^|\.)boards\.greenhouse\.io$/i.test(host);
}

// Greenhouse job boards are guest-application forms — no account, no login
// risk at all. Fill what we confidently know, leave custom questions to you,
// stop before the Submit Application button.
async function run(page, ctx) {
  await pause(800, 1500);

  await fillFirst(page, ['#first_name', 'input[name="job_application[first_name]"]'], ctx.firstName);
  await fillFirst(page, ['#last_name', 'input[name="job_application[last_name]"]'], ctx.lastName);
  await fillFirst(page, ['#email', 'input[name="job_application[email]"]'], ctx.email);
  await fillFirst(page, ['#phone', 'input[name="job_application[phone]"]'], ctx.phone);

  const uploaded = await uploadResumeGeneric(page, ctx.resumePath);
  if (!uploaded) {
    await waitForEnter('Could not find a resume upload field automatically — please attach the tailored resume yourself.');
  }

  if (await hasUnfilledRequiredFields(page)) {
    await waitForEnter('This application has required/custom questions the bot won\'t guess at. Fill them in, then continue.');
  }

  console.log('Greenhouse form filled — please review and click "Submit Application" yourself.');
  return 'review';
}

module.exports = { name: 'greenhouse', matches, run };
