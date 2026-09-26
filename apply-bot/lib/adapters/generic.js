const { pause, waitForEnter } = require('../human');
const { fillFirst, uploadResumeGeneric, hasUnfilledRequiredFields } = require('../formfill');

// Fallback for any company career page not covered by a dedicated adapter
// (custom-built forms, smaller ATSs like SmartRecruiters/iCIMS/etc). Best
// effort only: fills obvious name/email/phone fields and the resume upload,
// then always stops for a human rather than guessing at a submit button.
function matches() {
  return true;
}

async function run(page, ctx) {
  await pause(800, 1500);

  await fillFirst(page, ['input[name*="first_name" i]', 'input[id*="first_name" i]', 'input[autocomplete="given-name"]'], ctx.firstName);
  await fillFirst(page, ['input[name*="last_name" i]', 'input[id*="last_name" i]', 'input[autocomplete="family-name"]'], ctx.lastName);
  await fillFirst(page, ['input[type="email"]', 'input[name*="email" i]'], ctx.email);
  await fillFirst(page, ['input[type="tel"]', 'input[name*="phone" i]'], ctx.phone);

  const uploaded = await uploadResumeGeneric(page, ctx.resumePath);
  if (!uploaded) {
    await waitForEnter('Could not find a resume upload field automatically — please attach the tailored resume yourself.');
  }

  if (await hasUnfilledRequiredFields(page)) {
    await waitForEnter('There are required fields the bot won\'t guess at. Fill them in, then continue.');
  }

  console.log('\nThis site has no dedicated adapter, so this is best-effort — please double check every');
  console.log('field before submitting, and submit the application yourself.');
  return 'handoff';
}

module.exports = { name: 'generic', matches, run };
